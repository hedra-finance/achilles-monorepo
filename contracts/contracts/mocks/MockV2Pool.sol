// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";

/// @notice Uniswap V2 router and pair in one contract: x*y=k, 0.3% fee, this contract is the LP token.
///         Function signatures match the real V2 router/pair, so switching to a live deployment is an address
///         change. Single fixed pair (no factory), no MINIMUM_LIQUIDITY, deadline ignored, no access control.
contract MockV2Pool is ERC20 {
    using SafeERC20 for IERC20;

    address public immutable token0;
    address public immutable token1;
    uint112 private r0;
    uint112 private r1;

    constructor(address a, address b) ERC20("Mock Uniswap V2", "UNI-V2") {
        (token0, token1) = a < b ? (a, b) : (b, a);
    }

    function getReserves() external view returns (uint112, uint112, uint32) { return (r0, r1, 0); }

    function _sync() internal {
        r0 = uint112(IERC20(token0).balanceOf(address(this)));
        r1 = uint112(IERC20(token1).balanceOf(address(this)));
    }

    function getAmountOut(uint256 amountIn, uint256 rIn, uint256 rOut) public pure returns (uint256) {
        uint256 inFee = amountIn * 997;
        return inFee * rOut / (rIn * 1000 + inFee);
    }

    function swapExactTokensForTokens(
        uint256 amountIn, uint256 amountOutMin, address[] calldata path, address to, uint256
    ) external returns (uint256[] memory amounts) {
        require(path.length == 2, "path");
        bool zeroIn = path[0] == token0;
        require(zeroIn ? path[1] == token1 : (path[0] == token1 && path[1] == token0), "pair");
        (uint256 rIn, uint256 rOut) = zeroIn ? (r0, r1) : (r1, r0);
        uint256 out = getAmountOut(amountIn, rIn, rOut);
        require(out >= amountOutMin, "UniswapV2Router: INSUFFICIENT_OUTPUT_AMOUNT");
        IERC20(path[0]).safeTransferFrom(msg.sender, address(this), amountIn);
        IERC20(path[1]).safeTransfer(to, out);
        _sync();
        amounts = new uint256[](2); amounts[0] = amountIn; amounts[1] = out;
    }

    function _amounts(uint256 rA, uint256 rB, uint256 aDesired, uint256 bDesired, uint256 aMin, uint256 bMin)
        internal pure returns (uint256 amountA, uint256 amountB)
    {
        if (rA == 0 && rB == 0) return (aDesired, bDesired);
        uint256 bOpt = aDesired * rB / rA;
        if (bOpt <= bDesired) { require(bOpt >= bMin, "INSUFFICIENT_B_AMOUNT"); return (aDesired, bOpt); }
        uint256 aOpt = bDesired * rA / rB;
        require(aOpt <= aDesired && aOpt >= aMin, "INSUFFICIENT_A_AMOUNT");
        return (aOpt, bDesired);
    }

    struct Res { uint256 a; uint256 b; uint256 lp; }

    function addLiquidity(
        address tokenA, address tokenB, uint256 aDesired, uint256 bDesired, uint256 aMin, uint256 bMin, address to, uint256
    ) external returns (uint256, uint256, uint256) {
        Res memory r = _add(tokenA, tokenB, aDesired, bDesired, aMin, bMin, to);
        return (r.a, r.b, r.lp);
    }

    function _add(address tokenA, address tokenB, uint256 aDesired, uint256 bDesired, uint256 aMin, uint256 bMin, address to)
        internal returns (Res memory r)
    {
        bool aIs0 = tokenA == token0;
        require(aIs0 ? tokenB == token1 : (tokenA == token1 && tokenB == token0), "pair");
        (uint256 rA, uint256 rB) = aIs0 ? (r0, r1) : (r1, r0);
        (r.a, r.b) = _amounts(rA, rB, aDesired, bDesired, aMin, bMin);
        IERC20(tokenA).safeTransferFrom(msg.sender, address(this), r.a);
        IERC20(tokenB).safeTransferFrom(msg.sender, address(this), r.b);
        uint256 ts = totalSupply();
        r.lp = ts == 0 ? Math.sqrt(r.a * r.b) : Math.min(r.a * ts / rA, r.b * ts / rB);
        require(r.lp > 0, "INSUFFICIENT_LIQUIDITY_MINTED");
        _mint(to, r.lp);
        _sync();
    }

    function removeLiquidity(
        address tokenA, address tokenB, uint256 liquidity, uint256 aMin, uint256 bMin, address to, uint256
    ) external returns (uint256 amountA, uint256 amountB) {
        require((tokenA == token0 && tokenB == token1) || (tokenA == token1 && tokenB == token0), "pair");
        uint256 ts = totalSupply();
        amountA = liquidity * IERC20(tokenA).balanceOf(address(this)) / ts;
        amountB = liquidity * IERC20(tokenB).balanceOf(address(this)) / ts;
        require(amountA >= aMin && amountB >= bMin, "INSUFFICIENT_AMOUNT");
        // Router02 pulls the LP with transferFrom, so require the allowance the real one requires —
        // otherwise this mock silently accepts code that reverts against a canonical deployment.
        _spendAllowance(msg.sender, address(this), liquidity);
        _burn(msg.sender, liquidity);
        IERC20(tokenA).safeTransfer(to, amountA);
        IERC20(tokenB).safeTransfer(to, amountB);
        _sync();
    }
}
