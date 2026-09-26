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
    uint16 public maxDeviationBps;          // how far off 1:1 the pool may sit before we refuse to swap

    event Supplied(uint256 assets, uint256 swappedOut, uint256 lpMinted);
    event Withdrawn(uint256 assets, uint256 lpBurned, uint256 realized);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event ControllerSet(address controller);

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
        uint256 half = assets / 2;
        uint256 got = _swap(assetToken, counterToken, half);
        uint256 lp = _addLiquidity(assets - half, got);
        emit Supplied(assets, got, lp);
        return (0, Fulfillment.SYNC);
    }

    /// @dev Burns LP for the shortfall plus a slippage and peg-deviation margin, swaps the counter token back and sends exactly
    ///      `assets` to the controller. Reverts on shortfall rather than under-delivering; leftover asset stays
    ///      idle and joins the next allocation.
    function release(uint256 assets, bytes32, address, address) external onlyController returns (uint256, Fulfillment, uint256) {
        uint256 idle = assetToken.balanceOf(address(this));
        uint256 lpBurned;
        if (idle < assets) {
            // Margin covers the swap back at the worst pool price the deviation guard still allows; any
            // over-burn stays idle and joins the next allocation, whereas under-burning reverts the release.
            uint256 need = (assets - idle) * (BPS + slippageBps + maxDeviationBps) / BPS;
            uint256 lpBal = pair.balanceOf(address(this));
            uint256 lpValue = _lpValue(lpBal);
            lpBurned = need >= lpValue ? lpBal : need * lpBal / lpValue + 1;
            // Router02 pulls the LP with transferFrom, so it needs an allowance on the pair token.
            IERC20(address(pair)).forceApprove(address(router), lpBurned);
            (uint256 outA, uint256 outC) = router.removeLiquidity(
                address(assetToken), address(counterToken), lpBurned, 0, 0, address(this), block.timestamp);
            outA; // verified via balance below
            _swap(counterToken, assetToken, outC);
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
    function _reserves(address tokenIn) internal view returns (uint256 rIn, uint256 rOut) {
        (uint112 r0, uint112 r1,) = pair.getReserves();
        return pair.token0() == tokenIn ? (uint256(r0), uint256(r1)) : (uint256(r1), uint256(r0));
    }

    function _addLiquidity(uint256 a, uint256 c) internal returns (uint256 lp) {
        assetToken.forceApprove(address(router), a);
        counterToken.forceApprove(address(router), c);
        (,, lp) = router.addLiquidity(
            address(assetToken), address(counterToken), a, c,
            a * (BPS - slippageBps) / BPS, c * (BPS - slippageBps) / BPS, address(this), block.timestamp);
    }
}
