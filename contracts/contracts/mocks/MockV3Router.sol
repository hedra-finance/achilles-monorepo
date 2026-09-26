// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Test double combining a Uniswap V3 SwapRouter02 (exactInputSingle) and pool (slot0/token0).
///         Fills at a fixed rate with no slippage; tests set rate and sqrtPriceX96 directly. No access control.
contract MockV3Router {
    struct ExactInputSingleParams {
        address tokenIn; address tokenOut; uint24 fee; address recipient;
        uint256 amountIn; uint256 amountOutMinimum; uint160 sqrtPriceLimitX96;
    }

    mapping(address => mapping(address => uint256)) public rateWad; // tokenIn -> tokenOut -> WAD rate for fills
    address public token0;        // for slot0 consumers
    uint160 public sqrtPriceX96;  // for slot0 consumers

    function setRate(address tokenIn, address tokenOut, uint256 wad) external { rateWad[tokenIn][tokenOut] = wad; }
    function setToken0(address t) external { token0 = t; }
    function setSqrtPriceX96(uint160 v) external { sqrtPriceX96 = v; }

    function slot0() external view returns (uint160, int24, uint16, uint16, uint16, uint8, bool) {
        return (sqrtPriceX96, 0, 0, 0, 0, 0, true);
    }

    function exactInputSingle(ExactInputSingleParams calldata params) external returns (uint256 amountOut) {
        IERC20(params.tokenIn).transferFrom(msg.sender, address(this), params.amountIn);
        amountOut = params.amountIn * rateWad[params.tokenIn][params.tokenOut] / 1e18;
        require(amountOut >= params.amountOutMinimum, "MockSwapRouterPoolV3: slippage");
        IERC20(params.tokenOut).transfer(params.recipient, amountOut);
    }
}
