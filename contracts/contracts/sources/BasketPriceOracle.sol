// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import { Initializable } from "@openzeppelin/contracts/proxy/utils/Initializable.sol";

/// @title  BasketPriceOracle
/// @notice Push oracle for basket token reference prices: a keeper writes mirrored mainnet prices via
///         setPrice. On a chain with a live price feed, StockBasketSource.setOracle can point at an adapter
///         with the same getPrice shape instead.
contract BasketPriceOracle is Initializable {
    address public owner;
    mapping(address => uint256) public priceWad;  // token => USD price (1e18)
    mapping(address => uint256) public updatedAt;
    /// @notice Separate write role so the keeper bot does not hold the owner key. Appended storage (proxy-safe).
    address public writer;

    event PriceSet(address indexed token, uint256 priceWad);
    event WriterSet(address writer);

    constructor() { _disableInitializers(); }

    function initialize(address owner_) external initializer { owner = owner_; }

    modifier onlyOwner() { require(msg.sender == owner, "not owner"); _; }
    modifier onlyWriter() { require(msg.sender == owner || msg.sender == writer, "not writer"); _; }

    function setWriter(address w) external onlyOwner { writer = w; emit WriterSet(w); }

    function setPrice(address token, uint256 price) external onlyWriter {
        priceWad[token] = price;
        updatedAt[token] = block.timestamp;
        emit PriceSet(token, price);
    }

    function getPrice(address token) external view returns (uint256 price, uint256 ts) {
        return (priceWad[token], updatedAt[token]);
    }
}
