// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Initializable } from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import { IYieldSource, Fulfillment } from "../interfaces/IYieldSource.sol";
import { WireCodec } from "../bridge/WireCodec.sol";

/// @notice Uniswap V3 SwapRouter02 subset. V3 is used over V2 for the 0.05% fee tier: the basket trades every
///         settlement, so the fixed 0.3% V2 fee compounds into a material loss.
interface IV3SwapRouter02 {
    struct ExactInputSingleParams {
        address tokenIn; address tokenOut; uint24 fee; address recipient;
        uint256 amountIn; uint256 amountOutMinimum; uint160 sqrtPriceLimitX96;
    }
    function exactInputSingle(ExactInputSingleParams calldata params) external payable returns (uint256 amountOut);
}

interface IUniswapV3PoolMinimal {
    function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16, uint16, uint16, uint8, bool unlocked);
    function token0() external view returns (address);
}

interface IRobinhoodOracle {
    function getPrice(address token) external view returns (uint256 priceWad, uint256 updatedAt);
}

interface ISlippageSponsor {
    function cover(uint256 shortfall) external returns (uint256 paid);
}

/// @title  StockBasketSource
/// @notice Yield source holding a weighted basket of tokenized stocks, traded net at settlement time.
///         Allocations are SYNC (absorbed as idle cash); releases are ASYNC tickets. The keeper calls
///         rebalance() once per cycle, which trades only the net inflow/outflow, then marks release tickets
///         ready FIFO as cash becomes available. totalAssets = idle asset + sum(basket balance x pool price
///         from slot0). Basket size is variable (addBasket).
/// @dev    Upgradeable behind UpgradeableProxy; assetToken/router live in regular storage because all
///         proxies share the implementation bytecode.
contract StockBasketSource is Initializable, IYieldSource {
    using SafeERC20 for IERC20;

    struct Basket { IERC20 token; address pool; uint16 weightBps; uint24 fee; }

    IERC20 public assetToken; // base asset (6 decimals)
    IV3SwapRouter02 public router;
    address public controller;
    uint16 public slippageBps; // must exceed the pool fee tier (0.05%); anything tighter always reverts regardless of liquidity
    address public oracle; // BasketPriceOracle; replaceable by any adapter with the same getPrice shape
    uint16 public maxDeviationBps; // rebalance() reverts when pool price deviates from the oracle by more than this
    uint256 public constant BPS = 10_000;

    Basket[] public basket; // appended via addBasket()
    uint256 public pendingWithdrawTotal; // sum of release tickets not yet ready
    uint256 public reservedCash;         // sum of ready && !collected release tickets; excluded from buying

    struct P { uint8 kind; uint256 amount; bool ready; bool claimed; } // kind: 2 = release (allocations are SYNC, no ticket)
    uint256 public nextId;
    mapping(uint256 => P) public pend;
    string public displayName; // display name override; appended storage (proxy-safe). Empty = default name.
    address public sponsor;    // slippage sponsor; appended storage. 0 = no coverage.

    // Access control. Appended storage: live proxies upgraded from an implementation without these slots
    // must set them in the same tx via upgradeToAndCall(initializeV2).
    address public owner;  // admin: setters, basket config, ownership transfer
    address public keeper; // bot key allowed to call rebalance() besides owner/controller

    event Rebalanced(uint256 sold, uint256 bought, uint256 readyCount);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event KeeperSet(address keeper);
    event ControllerSet(address controller);
    event SponsorSet(address sponsor);
    event SlippageCovered(uint256 requested, uint256 paid);

    error PriceDeviation(address token, uint256 poolPrice, uint256 oraclePrice, uint256 deviationBps);
    error NotOwner();
    error NotController();
    error NotKeeper();

    modifier onlyOwner() { if (msg.sender != owner) revert NotOwner(); _; }
    modifier onlyController() { if (msg.sender != controller) revert NotController(); _; }

    /// @dev EIP-1967 admin slot; read through delegatecall, so this is the proxy's admin.
    function _proxyAdmin() internal view returns (address a) {
        assembly { a := sload(0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103) }
    }

    constructor() {
        _disableInitializers(); // implementation is only used behind a proxy
    }

    function initialize(address asset_, address router_, address oracle_) external initializer {
        assetToken = IERC20(asset_);
        router = IV3SwapRouter02(router_);
        oracle = oracle_;
        slippageBps = 10;      // 0.1%, clearly above the 0.05% pool fee
        maxDeviationBps = 300; // 3%
        nextId = 1;
        owner = msg.sender;
        emit OwnershipTransferred(address(0), msg.sender);
    }

    /// @notice Seeds owner/keeper on a live proxy upgraded from an implementation without access control.
    ///         Must be called in the same tx as the upgrade (upgradeToAndCall); called separately, anyone could
    ///         claim ownership first. Hence the proxy-admin check.
    function initializeV2(address owner_, address keeper_, address controller_) external reinitializer(2) {
        if (msg.sender != _proxyAdmin()) revert NotOwner();
        if (owner != address(0)) revert NotOwner(); // fresh deployments already set owner in initialize
        require(owner_ != address(0) && controller_ != address(0), "owner/controller");
        owner = owner_;
        keeper = keeper_;
        // Re-set the controller in the same tx: the previous implementation had an unguarded setController,
        // so an inherited value cannot be trusted.
        controller = controller_;
        emit OwnershipTransferred(address(0), owner_);
        emit KeeperSet(keeper_);
        emit ControllerSet(controller_);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "owner");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function setKeeper(address k) external onlyOwner { keeper = k; emit KeeperSet(k); }

    function setController(address c) external onlyOwner { controller = c; emit ControllerSet(c); }
    /// @dev Funds are guarded on the sponsor side (registration and caps), not here: pointing this at an
    ///      arbitrary address pays nothing unless that sponsor has registered this source.
    function setSponsor(address s) external onlyOwner { sponsor = s; emit SponsorSet(s); }

    /// @notice Cancels an open release ticket. A ticket larger than the holdings would block the FIFO forever.
    function cancelPending(uint256 id) external onlyOwner {
        P storage p = pend[id];
        require(p.kind == 2 && !p.ready && !p.claimed && p.amount > 0, "not cancellable");
        pendingWithdrawTotal -= p.amount;
        p.claimed = true; // retired without becoming ready; cannot be reactivated
    }
    function setRouter(address r) external onlyOwner { router = IV3SwapRouter02(r); }
    /// @dev Below 5 bps is tighter than the 0.05% pool fee and always reverts regardless of liquidity.
    function setSlippageBps(uint16 bps) external onlyOwner { require(bps > 5 && bps <= 2_000, "slippage out of range"); slippageBps = bps; }
    function setOracle(address o) external onlyOwner { oracle = o; }
    function setMaxDeviationBps(uint16 bps) external onlyOwner { maxDeviationBps = bps; }

    function basketCount() external view returns (uint256) { return basket.length; }

    /// @notice Appends a basket entry. Weights must sum to 10000 by the time rebalance runs.
    function addBasket(address token, address pool, uint16 weightBps, uint24 fee) external onlyOwner {
        require(token != address(0), "token");
        basket.push(Basket(IERC20(token), pool, weightBps, fee));
    }

    /// @notice Replaces a basket entry (pool swap, weight change, ...).
    function setBasket(uint256 idx, address token, address pool, uint16 weightBps, uint24 fee) external onlyOwner {
        require(idx < basket.length, "idx");
        require(token != address(0), "token");
        basket[idx] = Basket(IERC20(token), pool, weightBps, fee);
    }

    function setDisplayName(string calldata n) external onlyOwner { displayName = n; }
    function name() external view returns (string memory) {
        return bytes(displayName).length > 0 ? displayName : "Robinhood Basket (Uniswap V3 Mirror)";
    }
    function asset() external view returns (address) { return address(assetToken); }

    // --- IYieldSource ---

    function allocate(uint256 assets, bytes32, address, address) external onlyController returns (uint256, Fulfillment) {
        assetToken.safeTransferFrom(msg.sender, address(this), assets); // held idle; rebalance() buys later
        return (0, Fulfillment.SYNC);
    }

    function release(uint256 assets, bytes32, address, address) external onlyController returns (uint256, Fulfillment, uint256) {
        uint256 id = nextId++;
        pend[id] = P(2, assets, false, false);
        pendingWithdrawTotal += assets;
        return (id, Fulfillment.ASYNC, 0);
    }

    function isReady(uint256 id) external view returns (bool) { return pend[id].ready; }

    function collect(uint256 id) external onlyController returns (uint256) {
        P storage p = pend[id];
        require(p.ready && !p.claimed, "not ready");
        p.claimed = true;
        reservedCash -= p.amount;
        assetToken.safeTransfer(controller, p.amount);
        return p.amount;
    }

    function collectBatch(uint256[] calldata ids) external onlyController returns (uint256 total) {
        for (uint256 i; i < ids.length; i++) {
            P storage p = pend[ids[i]];
            require(p.ready && !p.claimed, "not ready");
            p.claimed = true;
            reservedCash -= p.amount;
            assetToken.safeTransfer(controller, p.amount);
            total += p.amount;
        }
    }

    function openRequests() external view returns (uint256[] memory) { return _pending(); }
    function openAllocations() external pure returns (uint256[] memory ids) { ids = new uint256[](0); } // allocations are always SYNC
    function openReleases() external view returns (uint256[] memory) { return _pending(); }

    function _pending() internal view returns (uint256[] memory ids) {
        uint256 n = nextId; uint256 cnt;
        for (uint256 i = 1; i < n; i++) if (!pend[i].claimed) cnt++;
        ids = new uint256[](cnt); uint256 j;
        for (uint256 i = 1; i < n; i++) if (!pend[i].claimed) ids[j++] = i;
    }

    function totalAssets() external view returns (uint256) {
        uint256 total = assetToken.balanceOf(address(this));
        for (uint256 i; i < basket.length; i++) {
            Basket storage b = basket[i];
            uint256 bal = b.token.balanceOf(address(this));
            if (bal > 0) total += bal * _price(b) / 1e18;
        }
        return total;
    }

    /// @notice IMultiAssetSource: reports idle asset and each basket token as its own (amount, price) position
    ///         so settlement records keep per-token prices. Price equals _price() (WAD; asset and tokens share
    ///         6 decimals, so it doubles as the USD unit price).
    function assetPositions() external view returns (WireCodec.AssetPosition[] memory pos) {
        pos = new WireCodec.AssetPosition[](basket.length + 1);
        uint256 idle = assetToken.balanceOf(address(this));
        pos[0] = WireCodec.AssetPosition(address(assetToken), idle, 1e18, idle, true);
        for (uint256 i; i < basket.length; i++) {
            Basket storage b = basket[i];
            uint256 bal = b.token.balanceOf(address(this));
            uint256 price = _price(b);
            pos[i + 1] = WireCodec.AssetPosition(address(b.token), bal, price, bal * price / 1e18, true);
        }
    }

    /// @dev "1 basket token = ? asset" (WAD) from the pool's slot0().sqrtPriceX96. No decimals correction:
    ///      basket tokens must use the asset's decimals (enforced by the deploy script).
    function _price(Basket storage b) internal view returns (uint256) {
        (uint160 sqrtPriceX96,,,,,,) = IUniswapV3PoolMinimal(b.pool).slot0();
        bool tokenIsToken0 = IUniswapV3PoolMinimal(b.pool).token0() == address(b.token);
        return _sqrtPriceToWad(sqrtPriceX96, tokenIsToken0);
    }

    /// @dev Converts sqrtPriceX96 (Q64.96 sqrt of token1/token0) to a WAD price (asset per token). Both tokens
    ///      share decimals. rr = sqrtPriceX96^2 fits uint256 for realistic prices; the 2^192 division is done in
    ///      two 2^96 steps to keep precision. When the token is token1 the ratio is inverted.
    function _sqrtPriceToWad(uint160 sqrtPriceX96, bool tokenIsToken0) internal pure returns (uint256) {
        uint256 rr = uint256(sqrtPriceX96) * uint256(sqrtPriceX96);
        if (rr == 0) return 0;
        if (tokenIsToken0) return ((rr >> 96) * 1e18) >> 96; // price(token1/token0) = asset per token
        return (uint256(1e18) << 192) / rr; // token is token1: invert
    }

    /// @dev Reverts when the pool price deviates from the oracle by more than maxDeviationBps, so a manipulated
    ///      or stale pool is never traded. Skipped when no oracle is set or it has no price yet.
    function _checkOracle(Basket storage b) internal view {
        if (oracle == address(0)) return;
        (uint256 oraclePrice,) = IRobinhoodOracle(oracle).getPrice(address(b.token));
        if (oraclePrice == 0) return;
        uint256 poolPrice = _price(b);
        if (poolPrice == 0) return;
        uint256 diff = poolPrice > oraclePrice ? poolPrice - oraclePrice : oraclePrice - poolPrice;
        uint256 diffBps = diff * BPS / oraclePrice;
        if (diffBps > maxDeviationBps) revert PriceDeviation(address(b.token), poolPrice, oraclePrice, diffBps);
    }

    /// @notice Keeper entry: trades only the net inflow/outflow, then marks release tickets ready FIFO with the cash secured.
    function rebalance() external {
        if (msg.sender != owner && msg.sender != controller && msg.sender != keeper) revert NotKeeper();
        for (uint256 i; i < basket.length; i++) {
            Basket storage b = basket[i];
            if (b.weightBps > 0) _checkOracle(b);
        }

        uint256 idle = assetToken.balanceOf(address(this)) - reservedCash;
        uint256 need = pendingWithdrawTotal;
        uint256 sold;
        uint256 slip; // slippage measured per swap
        if (idle < need) {
            uint256 slipSold;
            (sold, slipSold) = _sellForShortfall(need - idle);
            slip += slipSold;
            // Cover the execution loss now; otherwise the shortfall keeps tickets from becoming ready this
            // round and the whole redemption slips to the next settlement.
            _coverSlippage(slip);
            slip = 0;
            idle = assetToken.balanceOf(address(this)) - reservedCash;
        }

        uint256 readyCount;
        for (uint256 i = 1; i < nextId; i++) {
            P storage p = pend[i];
            if (p.claimed || p.ready || p.amount == 0) continue; // finished tickets are skipped, not a stop condition
            if (idle < p.amount) break; // FIFO: if the first live ticket cannot be funded, later ones wait too
            p.ready = true;
            idle -= p.amount;
            pendingWithdrawTotal -= p.amount;
            reservedCash += p.amount;
            readyCount++;
        }

        // Buy with surplus only after excluding tickets still waiting, so freshly sold cash is not bought back.
        uint256 bought;
        uint256 spare = idle > pendingWithdrawTotal ? idle - pendingWithdrawTotal : 0;
        if (spare > 0) {
            uint256 slipBought;
            (bought, slipBought) = _buyWithSurplus(spare);
            slip += slipBought;
        }
        emit Rebalanced(sold, bought, readyCount);
        _coverSlippage(slip);
    }

    /// @dev Bills the measured slippage to the sponsor. A missing or failing sponsor never blocks the rebalance;
    ///      blocking redemptions would be worse than an uncovered loss.
    function _coverSlippage(uint256 shortfall) internal {
        address s = sponsor;
        if (s == address(0) || shortfall == 0) return;
        try ISlippageSponsor(s).cover(shortfall) returns (uint256 paid) {
            emit SlippageCovered(shortfall, paid);
        } catch {
            emit SlippageCovered(shortfall, 0);
        }
    }

    /// @return soldUsdc  asset actually received
    /// @return slipUsdc  sum of (expected at pre-swap pool price - received)
    function _sellForShortfall(uint256 usdcNeeded) internal returns (uint256 soldUsdc, uint256 slipUsdc) {
        for (uint256 i; i < basket.length && soldUsdc < usdcNeeded; i++) {
            Basket storage b = basket[i];
            if (b.weightBps == 0) continue;
            uint256 portion = usdcNeeded * b.weightBps / BPS;
            if (portion < 1e6) portion = 1e6; // at least 1 unit per leg: micro swaps lose more to V3 rounding than the slippage buffer allows
            uint256 price = _price(b);
            if (price == 0) continue;
            uint256 tokenAmt = (portion * 1e18 + price - 1) / price; // round up so rounding never undershoots the target
            uint256 have = b.token.balanceOf(address(this));
            if (tokenAmt > have) tokenAmt = have;
            if (tokenAmt == 0) continue;
            uint256 minOut = (tokenAmt * price / 1e18) * (BPS - slippageBps) / BPS; // based on the actual sell size; the original portion would always revert when capped by holdings
            uint256 expected = tokenAmt * price / 1e18; // asset receivable with zero price impact
            uint256 out = _swap(address(b.token), address(assetToken), b.fee, tokenAmt, minOut);
            soldUsdc += out;
            if (out < expected) slipUsdc += expected - out;
        }
    }

    /// @return spentUsdc asset actually spent
    /// @return slipUsdc  token shortfall vs. expectation, valued at the pre-swap price
    function _buyWithSurplus(uint256 usdcAvailable) internal returns (uint256 spentUsdc, uint256 slipUsdc) {
        for (uint256 i; i < basket.length; i++) {
            Basket storage b = basket[i];
            if (b.weightBps == 0) continue;
            uint256 amountIn = usdcAvailable * b.weightBps / BPS;
            if (amountIn < 1e6) continue; // skip dust buys (symmetric with selling); leftovers stay idle for the next cycle
            uint256 price = _price(b);
            if (price == 0) continue;
            uint256 minOut = (amountIn * 1e18 / price) * (BPS - slippageBps) / BPS;
            uint256 expected = amountIn * 1e18 / price; // tokens receivable with zero price impact
            uint256 out = _swap(address(assetToken), address(b.token), b.fee, amountIn, minOut);
            spentUsdc += amountIn;
            if (out < expected) slipUsdc += (expected - out) * price / 1e18;
        }
    }

    function _swap(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint256 minOut) internal returns (uint256) {
        IERC20(tokenIn).forceApprove(address(router), amountIn);
        return router.exactInputSingle(IV3SwapRouter02.ExactInputSingleParams({
            tokenIn: tokenIn, tokenOut: tokenOut, fee: fee, recipient: address(this),
            amountIn: amountIn, amountOutMinimum: minOut, sqrtPriceLimitX96: 0
        }));
    }
}
