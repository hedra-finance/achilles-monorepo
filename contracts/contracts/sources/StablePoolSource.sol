// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import { Initializable } from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { IYieldSource, Fulfillment } from "../interfaces/IYieldSource.sol";
import { WireCodec } from "../bridge/WireCodec.sol";

interface IUniswapV2RouterMinimal {
    function swapExactTokensForTokens(uint256, uint256, address[] calldata, address, uint256) external returns (uint256[] memory);
    function addLiquidity(address, address, uint256, uint256, uint256, uint256, address, uint256) external returns (uint256, uint256, uint256);
    function removeLiquidity(address, address, uint256, uint256, uint256, address, uint256) external returns (uint256, uint256);
}
interface IUniswapV2PairMinimal is IERC20 {
    function getReserves() external view returns (uint112, uint112, uint32);
    function token0() external view returns (address);
}

/// @title  StablePoolSource
/// @notice Yield source that provides liquidity to a 1:1 stable pair (e.g. USDC/USDT) on a Uniswap V2 pool.
///         Allocate: swap half to the counter token and addLiquidity. Release: removeLiquidity, swap the counter
///         token back and return immediately (SYNC). Value: idle balances + LP share of 2*sqrt(r0*r1).
///         Trading fees that grow the reserves are the yield. Targets a canonical Uniswap V2 deployment:
///         `router` is UniswapV2Router02 and `pair` the UniswapV2Pair created by the canonical factory.
/// @dev    Both tokens are assumed to share the asset's decimals and peg 1:1: the counter token is valued at
///         $1 and swap minOut is slippageBps off the pool's own quote, with maxDeviationBps bounding how far
///         the pool may sit off 1:1 at all. Non-pegged pairs would need an oracle. Access control
///         mirrors StockBasketSource (owner/controller); no keeper because there is no rebalance.
contract StablePoolSource is Initializable, IYieldSource {
    using SafeERC20 for IERC20;

    IERC20 public assetToken;               // base asset
    IERC20 public counterToken;             // pair counterpart
    IUniswapV2RouterMinimal public router;
    IUniswapV2PairMinimal public pair;      // LP token and reserve source
    address public controller;
    address public owner;
    uint16 public slippageBps;              // swap minOut and LP removal margin; must exceed the 0.3% V2 fee
    string public displayName;
    uint256 public constant BPS = 10_000;
    /// @dev Used when entryBandBps was never set, so an upgraded proxy is not stuck refusing every entry.
    uint16 internal constant DEFAULT_ENTRY_BAND_BPS = 30;
    uint16 public maxDeviationBps;          // how far off 1:1 the pool may sit before we refuse to swap
    uint16 public entryBandBps;             // how close to 1:1 the pool must sit before we enter it
    address public inventory;               // par-exchange desk: supplies the missing leg at 1:1 instead of the pool

    event Supplied(uint256 assets, uint256 swappedOut, uint256 lpMinted);
    event Withdrawn(uint256 assets, uint256 lpBurned, uint256 realized);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event ControllerSet(address controller);
    event InventorySet(address inventory);
    /// @notice A leg sourced from the desk at par instead of bought from the pool. Equal amounts both ways,
    ///         so the position's value is unchanged — only its composition is.
    event InventoryUsed(address indexed desk, address gave, address took, uint256 amount);

    error NotOwner();
    error NotController();

    modifier onlyOwner() { if (msg.sender != owner) revert NotOwner(); _; }
    modifier onlyController() { if (msg.sender != controller) revert NotController(); _; }

    constructor() { _disableInitializers(); }

    function initialize(address asset_, address counter_, address router_, address pair_) external initializer {
        assetToken = IERC20(asset_);
        counterToken = IERC20(counter_);
        router = IUniswapV2RouterMinimal(router_);
        pair = IUniswapV2PairMinimal(pair_);
        address t0 = pair.token0();
        require(t0 == asset_ || t0 == counter_, "pair/tokens");
        slippageBps = 100; // 1%: 0.3% fee plus price impact headroom
        maxDeviationBps = 500; // 5%: normal trading drift passes, a manipulated pool does not
        entryBandBps = DEFAULT_ENTRY_BAND_BPS; // 0.3%: entering costs about the swap fee and no more
        owner = msg.sender;
        emit OwnershipTransferred(address(0), msg.sender);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "owner");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }
    function setController(address c) external onlyOwner { controller = c; emit ControllerSet(c); }
    function setSlippageBps(uint16 bps) external onlyOwner { require(bps > 30 && bps <= 2_000, "slippage out of range"); slippageBps = bps; }
    function setMaxDeviationBps(uint16 bps) external onlyOwner { require(bps > 0 && bps <= 2_000, "deviation out of range"); maxDeviationBps = bps; }
    function setEntryBandBps(uint16 bps) external onlyOwner { require(bps > 0 && bps <= 500, "band out of range"); entryBandBps = bps; }
    /// @notice Sets the par-exchange desk. Zero disables it and entries fall back to trading the pool.
    function setInventory(address desk) external onlyOwner { inventory = desk; emit InventorySet(desk); }

    /// @notice Existing proxies were deployed before maxDeviationBps existed and read it as 0, which would
    ///         refuse every swap. Called once from the upgrade.
    function initializeV2(uint16 bps) external onlyOwner { require(maxDeviationBps == 0, "already set"); require(bps > 0 && bps <= 2_000, "deviation out of range"); maxDeviationBps = bps; }
    function setDisplayName(string calldata n) external onlyOwner { displayName = n; }

    function name() external view returns (string memory) {
        return bytes(displayName).length > 0 ? displayName : "Uniswap V2 LP (USDC/USDT)";
    }
    function asset() external view returns (address) { return address(assetToken); }

    // --- IYieldSource ---

    function allocate(uint256 assets, bytes32, address, address) external onlyController returns (uint256, Fulfillment) {
        assetToken.safeTransferFrom(msg.sender, address(this), assets);
        _enter();
        return (0, Fulfillment.SYNC);
    }

    /// @notice Puts idle asset into the pool, if the pool is close enough to 1:1 to be worth entering.
    /// @dev    Permissionless on purpose: it can only act inside the band, so there is nothing to extract
    ///         by choosing the moment, and it saves the keeper another key. Returns false when it declined,
    ///         which is a normal outcome, not an error — the caller retries on the next cycle.
    function enter() external returns (bool) { return _enter(); }

    /// @dev Entering means selling half the deposit to the pool at whatever price the pool currently
    ///      holds. A skewed pool therefore charges the depositor the skew on that half, which dwarfs the
    ///      0.3% fee: a 2% skew cost one deposit 1.1% of principal. Idle asset is valued at par by
    ///      totalAssets(), so waiting for the pool to come back is free, while entering is not.
    function _enter() internal returns (bool) {
        uint256 a = assetToken.balanceOf(address(this));
        uint256 c = counterToken.balanceOf(address(this));
        if (a == 0 && c == 0) return false;

        // Trade only the imbalance, and fill it from the desk at par before buying any of it from the pool.
        // Swapping a fixed half ignored counter token the contract already held, and selling asset we did
        // not need to sell is what made a deposit cost the fee on half of itself — a cost that reached every
        // holder through NAV rather than the depositor.
        //
        // The band gates the purchase, not the entry: trading into a skewed pool is what costs money, and a
        // desk covering the whole gap never touches the pool, so holding the entry back would be a condition
        // guarding nothing. Adding at a skewed ratio is not a loss either — the router takes less of one side
        // and the rest stays idle, valued at par.
        uint256 swapped;
        if (a != c) {
            bool sellAsset = a > c;
            (IERC20 give, IERC20 take) = sellAsset ? (assetToken, counterToken) : (counterToken, assetToken);
            uint256 gap = (sellAsset ? a - c : c - a) / 2;
            uint256 atPar = _fromInventory(give, take, gap);
            uint256 rest = gap - atPar;
            if (rest > 0) {
                // Nothing matched and the pool is too skewed to buy from: wait rather than pay the skew.
                if (!_withinBand()) { if (atPar == 0) return false; }
                else swapped = _swap(give, take, rest);
            }
            swapped += atPar;
        }
        uint256 lp = _addLiquidity(assetToken.balanceOf(address(this)), counterToken.balanceOf(address(this)));
        emit Supplied(a, swapped, lp);
        return true;
    }

    /// @dev Whether the pool sits close enough to 1:1 that buying the missing leg from it is acceptable.
    function _withinBand() internal view returns (bool) {
        (uint256 rA, uint256 rC) = _reserves(address(assetToken));
        uint256 band = entryBandBps == 0 ? DEFAULT_ENTRY_BAND_BPS : entryBandBps;
        uint256 diff = rA > rC ? rA - rC : rC - rA;
        return diff * BPS <= (rA + rC) * band;
    }

    /// @dev Burns LP for the shortfall plus a slippage and peg-deviation margin, swaps the counter token back and sends exactly
    ///      `assets` to the controller. Reverts on shortfall rather than under-delivering; leftover asset stays
    ///      idle and joins the next allocation.
    function release(uint256 assets, bytes32, address, address) external onlyController returns (uint256, Fulfillment, uint256) {
        uint256 lpBurned;
        if (assetToken.balanceOf(address(this)) < assets) {
            lpBurned = _burnFor(assets - assetToken.balanceOf(address(this)));
            // Sell only what is still missing. Dumping the whole counter leg back would pay the fee on it
            // and throw away the inventory that makes the next entry free; what stays is valued at par.
            uint256 have = assetToken.balanceOf(address(this));
            if (have < assets) _swap(counterToken, assetToken, _counterFor(assets - have));
        }
        require(assetToken.balanceOf(address(this)) >= assets, "insufficient realized");
        assetToken.safeTransfer(controller, assets);
        emit Withdrawn(assets, lpBurned, assets);
        return (0, Fulfillment.SYNC, assets);
    }

    function isReady(uint256) external pure returns (bool) { return true; }
    function collect(uint256) external pure returns (uint256) { return 0; }          // all SYNC, no tickets
    function collectBatch(uint256[] calldata) external pure returns (uint256) { return 0; }
    function openRequests() external pure returns (uint256[] memory ids) { ids = new uint256[](0); }
    function openAllocations() external pure returns (uint256[] memory ids) { ids = new uint256[](0); }
    function openReleases() external pure returns (uint256[] memory ids) { ids = new uint256[](0); }

    function totalAssets() public view returns (uint256) {
        return assetToken.balanceOf(address(this)) + counterToken.balanceOf(address(this)) + _lpValue(pair.balanceOf(address(this)));
    }

    /// @notice Positions for settlement records: idle asset, idle counter token, LP (unit price = value / LP amount). All counted.
    function assetPositions() external view returns (WireCodec.AssetPosition[] memory pos) {
        pos = new WireCodec.AssetPosition[](3);
        uint256 a = assetToken.balanceOf(address(this));
        uint256 c = counterToken.balanceOf(address(this));
        uint256 lp = pair.balanceOf(address(this));
        uint256 lpVal = _lpValue(lp);
        pos[0] = WireCodec.AssetPosition(address(assetToken), a, 1e18, a, true);
        pos[1] = WireCodec.AssetPosition(address(counterToken), c, 1e18, c, true);
        pos[2] = WireCodec.AssetPosition(address(pair), lp, lp == 0 ? 0 : lpVal * 1e18 / lp, lpVal, true);
    }

    /// @notice Operator view: current LP position valued in the base asset.
    function lpValue() external view returns (uint256) { return _lpValue(pair.balanceOf(address(this))); }

    // --- internal ---

    function _lpValue(uint256 lp) internal view returns (uint256) {
        if (lp == 0) return 0;
        (uint112 r0, uint112 r1,) = pair.getReserves();
        // Fair value = 2*sqrt(r0*r1) / totalSupply: insensitive to a skewed pool right after a swap and grows
        // only as fees grow k (both tokens at $1). A plain reserve sum overstates a skewed pool.
        return lp * 2 * Math.sqrt(uint256(r0) * uint256(r1)) / pair.totalSupply();
    }

    function _swap(IERC20 tokenIn, IERC20 tokenOut, uint256 amountIn) internal returns (uint256 out) {
        if (amountIn == 0) return 0;
        tokenIn.forceApprove(address(router), amountIn);
        address[] memory path = new address[](2);
        path[0] = address(tokenIn); path[1] = address(tokenOut);
        uint256[] memory amounts = router.swapExactTokensForTokens(
            amountIn, _minOut(tokenIn, amountIn), path, address(this), block.timestamp);
        out = amounts[amounts.length - 1];
    }

    /// @dev minOut has to come off the pool's own curve, not off the 1:1 peg. A pool that the fee-generating
    ///      trading has skewed pays out less than amountIn at any slippage setting, so a peg-derived bound
    ///      reverts with INSUFFICIENT_OUTPUT_AMOUNT and takes the whole delivery down with it. slippageBps is
    ///      the tolerance against the quote; the peg check is what keeps a sandwich from moving the quote.
    function _minOut(IERC20 tokenIn, uint256 amountIn) internal view returns (uint256) {
        (uint256 rIn, uint256 rOut) = _reserves(address(tokenIn));
        require(rIn * BPS <= rOut * (BPS + maxDeviationBps) && rOut * BPS <= rIn * (BPS + maxDeviationBps), "pool off peg");
        uint256 inWithFee = amountIn * 997;
        uint256 quoted = inWithFee * rOut / (rIn * 1000 + inWithFee);
        return quoted * (BPS - slippageBps) / BPS;
    }

    /// @dev Reserves oriented as (reserve of `tokenIn`, reserve of the other token).
    /// @dev Exchanges up to `want` with the desk one for one. Both legs are pegged and share the asset's
    ///      decimals, so equal raw amounts are equal value and totalAssets() does not move — the desk cannot
    ///      be drained by choosing a moment, and this only runs inside the entry band anyway. Bounded by what
    ///      the desk holds and has approved, so revoking the allowance turns it off without an upgrade.
    function _fromInventory(IERC20 give, IERC20 take, uint256 want) internal returns (uint256 amt) {
        address desk = inventory;
        if (desk == address(0)) return 0;
        uint256 avail = take.balanceOf(desk);
        uint256 allowed = take.allowance(desk, address(this));
        if (allowed < avail) avail = allowed;
        amt = want < avail ? want : avail;
        if (amt == 0) return 0;
        take.safeTransferFrom(desk, address(this), amt);
        give.safeTransfer(desk, amt);
        emit InventoryUsed(desk, address(give), address(take), amt);
    }

    /// @dev Burns enough LP to cover `shortfall` of asset, plus the margin the swap back may cost at the
    ///      worst price the deviation guard still allows. Over-burning leaves idle, which is valued at par;
    ///      under-burning reverts the release, so the margin errs upward. Returns the LP burned.
    function _burnFor(uint256 shortfall) internal returns (uint256 lpBurned) {
        uint256 need = shortfall * (BPS + slippageBps + maxDeviationBps) / BPS;
        uint256 lpBal = pair.balanceOf(address(this));
        uint256 value = _lpValue(lpBal);
        lpBurned = need >= value ? lpBal : need * lpBal / value + 1;
        // Router02 pulls the LP with transferFrom, so it needs an allowance on the pair token.
        IERC20(address(pair)).forceApprove(address(router), lpBurned);
        router.removeLiquidity(address(assetToken), address(counterToken), lpBurned, 0, 0, address(this), block.timestamp);
    }

    /// @dev Counter token to sell to realise `want` of asset, with the slippage margin, capped at what we hold.
    function _counterFor(uint256 want) internal view returns (uint256) {
        uint256 need = want * (BPS + slippageBps) / BPS;
        uint256 held = counterToken.balanceOf(address(this));
        return need > held ? held : need;
    }

    function _reserves(address tokenIn) internal view returns (uint256 rIn, uint256 rOut) {
        (uint112 r0, uint112 r1,) = pair.getReserves();
        return pair.token0() == tokenIn ? (uint256(r0), uint256(r1)) : (uint256(r1), uint256(r0));
    }

    /// @dev Offers the pool its own ratio rather than whatever we happen to hold. The router always takes
    ///      both sides in the current reserve ratio and reverts if the trimmed side falls below the minimum,
    ///      so passing raw balances into a skewed pool fails on INSUFFICIENT_B_AMOUNT. Sizing to the ratio
    ///      first means the minimums only have to cover movement inside this transaction; whatever does not
    ///      fit stays idle and is valued at par.
    function _addLiquidity(uint256 a, uint256 c) internal returns (uint256 lp) {
        if (a == 0 || c == 0) return 0;
        (uint256 rA, uint256 rC) = _reserves(address(assetToken));
        if (rA > 0 && rC > 0) {
            uint256 cForA = a * rC / rA;
            if (cForA <= c) c = cForA;
            else a = c * rA / rC;
            if (a == 0 || c == 0) return 0;
        }
        assetToken.forceApprove(address(router), a);
        counterToken.forceApprove(address(router), c);
        (,, lp) = router.addLiquidity(
            address(assetToken), address(counterToken), a, c,
            a * (BPS - slippageBps) / BPS, c * (BPS - slippageBps) / BPS, address(this), block.timestamp);
    }
}
