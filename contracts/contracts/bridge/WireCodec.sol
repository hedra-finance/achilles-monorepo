// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

/// @title  WireCodec
/// @notice Single-payload encoding for every bridge message: `abi.encode(Envelope)`. Unused fields are
///         0 / empty, so an indexer decodes every kind with one ABI. Tranche identity is (source chain, vault)
///         from kinds 1 and 2; there is no separate index field. Nested struct arrays (AdapterValuation[],
///         SettleItem[]) are encoded a second time into `data` to keep the legacy codegen decoder under the
///         stack limit. sourceChain, sender and amount come from receiveMessage and are not in the payload.
library WireCodec {
    // kind 1..10
    uint8 internal constant DEPOSIT_REQUEST     = 1;  // spoke -> hub, carries assets (remainder)
    uint8 internal constant REDEEM_REQUEST      = 2;  // spoke -> hub, no assets
    uint8 internal constant SETTLEMENT_COLLECT  = 3;  // hub -> spoke, no assets
    uint8 internal constant SETTLEMENT_RESPONSE = 4;  // spoke -> hub, carries realized redeem proceeds on finalization
    uint8 internal constant SETTLEMENT_FINALIZE = 5;  // hub -> spoke, carries the payout allocation on finalization
    uint8 internal constant REBALANCE_BRIDGE    = 6;  // spoke -> hub, carries assets (recalled funds)
    uint8 internal constant ADAPTER_SUPPLY      = 7;  // hub -> spoke, carries assets (allocation)
    uint8 internal constant ADAPTER_WITHDRAW    = 8;  // hub -> spoke, no assets (release order; `flag` selects purpose)
    uint8 internal constant WHITELIST_SYNC      = 9;  // hub -> spoke, no assets
    uint8 internal constant ALLOCATION_SYNC     = 10; // hub -> spoke, no assets

    // flag for kind 9
    uint8 internal constant ACTION_REVOKE = 0;
    uint8 internal constant ACTION_GRANT  = 1;   // grant == allowed(true)

    // flag for kind 8. 0 matches the original rebalance wire, so indexers stay compatible.
    //   REBALANCE: release the operator-specified sources/amounts; proceeds return via kind 6 (requestId 0x0)
    //   PAYOUT:    redeem funding. amount = full expected payout; the receiving chain releases only its local
    //              share (same math as requestRedeem on the requesting chain). Proceeds ride with kind 4.
    uint8 internal constant WITHDRAW_REBALANCE = 0;
    uint8 internal constant WITHDRAW_PAYOUT    = 1;

    /// @notice The single payload for all kinds. Unused fields are 0 / empty.
    struct Envelope {
        uint8   kind;          // 1..10
        uint64  productId;     // always set: uint32 prefix | uint32 seq (same shape as the requestId high 64 bits)
        bytes32 requestId;     // request kinds (1,2,7,8) only
        uint256 settlementId;  // settlement kinds (3,4,5,6) only
        uint8   flag;          // 9 action, 8 purpose
        address account;       // 1,2 investor (request controller); 9 subject
        address vault;         // 1,2,9 vault address
        uint256 amount;        // 1 assets; 2 shares; 4 chainNav; 5 declared payout (first chunk only)
        uint256 aux;           // 1 weightsVersion; 2 localInitiated; 4 declared realized redeem proceeds; 9 nonce; 10 (weightsVersion<<16 | localShareBps)
        address[] addrs;       // 8 release targets; 10 sources
        uint256[] nums;        // 3 lastPrices; 4 supplyRecvCum (one entry); 5 sharePrices; 8 amounts; 10 weightBps
        bytes   data;          // 4 abi.encode(AdapterValuation[]); 5 abi.encode(SettleItem[], SettleItem[])
    }

    struct SettleItem { bytes32 requestId; address investor; uint256 amount; } // deposit = shares, redeem = assets

    struct AssetPosition {
        address asset;    // local token address on that chain
        uint256 amount;   // in asset decimals
        uint256 priceUsd; // 1e18
        uint256 usdValue; // amount * priceUsd, recorded alongside for verification
        bool    counted;  // included in chain NAV (false for unswapped reward tokens)
    }

    struct AdapterValuation {
        uint64  chainId;         // EVM chain id; global key = (chainId, adapter)
        address adapter;
        uint256 epochId;         // source-local epoch
        uint64  valuationCutoff;
        uint256 principal;       // total principal allocated
        AssetPosition[] positions;
    }

    // record_settlement input: per-tranche result after the waterfall (product_nav = sum of tranche_nav).
    struct TrancheSettle {
        uint64  vault_chain_id;    // chain of the tranche vault
        address vault_address;     // tranche vault address
        uint256 tranche_nav;       // tranche NAV after the waterfall
        uint256 share_price;       // settled price (1e18)
        uint256 units_outstanding; // shares outstanding; denominator for the next cycle
        uint256 principal;         // senior principal (waterfall target); 0 for junior
    }

    function _noAddrs() private pure returns (address[] memory a) { a = new address[](0); }
    function _noNums() private pure returns (uint256[] memory n) { n = new uint256[](0); }

    // --- encode: all abi.encode(Envelope) ---

    function encodeDepositReq(uint64 productId, bytes32 requestId, uint256 amount, uint256 weightsVersion, address investor, address vault)
        internal pure returns (bytes memory)
    {
        return abi.encode(Envelope(DEPOSIT_REQUEST, productId, requestId, 0, 0, investor, vault, amount, weightsVersion, _noAddrs(), _noNums(), ""));
    }

    function encodeRedeemReq(uint64 productId, bytes32 requestId, uint256 shares, address investor, uint256 localInitiated, address vault)
        internal pure returns (bytes memory)
    {
        return abi.encode(Envelope(REDEEM_REQUEST, productId, requestId, 0, 0, investor, vault, shares, localInitiated, _noAddrs(), _noNums(), ""));
    }

    /// @param lastPrices previous settled prices (tranche order) so spokes refresh their price cache even on a quiet settlement
    function encodeCollectNav(uint64 productId, uint256 settlementId, uint256[] memory lastPrices) internal pure returns (bytes memory)
    {
        return abi.encode(Envelope(SETTLEMENT_COLLECT, productId, 0, settlementId, 0, address(0), address(0), 0, 0, _noAddrs(), lastPrices, ""));
    }

    /// @param payoutShipped declared realized redeem proceeds shipped with this message
    /// @param supplyRecvCum cumulative deposit allocations this chain has received; the hub computes
    ///        "sent - received = in transit" and counts it as NAV. An empty array (older senders) means all landed.
    function encodeNavResponse(uint64 productId, uint256 settlementId, uint256 chainNav, uint256 payoutShipped, uint256 supplyRecvCum, AdapterValuation[] memory vals)
        internal pure returns (bytes memory)
    {
        uint256[] memory n = new uint256[](1);
        n[0] = supplyRecvCum;
        return abi.encode(Envelope(SETTLEMENT_RESPONSE, productId, 0, settlementId, 0, address(0), address(0), chainNav, payoutShipped, _noAddrs(), n, abi.encode(vals)));
    }

    /// @param payoutAmount declared payout allocation shipped with this chunk; only the first chunk per round is > 0
    function encodeSettleDistribute(
        uint64 productId,
        uint256 settlementId,
        SettleItem[] memory deposits,
        SettleItem[] memory redeems,
        uint256[] memory sharePrices, // settled price per tranche for the spoke price cache
        uint256 payoutAmount
    ) internal pure returns (bytes memory)
    {
        return abi.encode(Envelope(SETTLEMENT_FINALIZE, productId, 0, settlementId, 0, address(0), address(0), payoutAmount, 0, _noAddrs(), sharePrices, abi.encode(deposits, redeems)));
    }

    function encodeNetBridge(uint64 productId, uint256 settlementId) internal pure returns (bytes memory)
    {
        return abi.encode(Envelope(REBALANCE_BRIDGE, productId, 0, settlementId, 0, address(0), address(0), 0, 0, _noAddrs(), _noNums(), ""));
    }

    function encodeSupply(uint64 productId, bytes32 requestId) internal pure returns (bytes memory)
    {
        return abi.encode(Envelope(ADAPTER_SUPPLY, productId, requestId, 0, 0, address(0), address(0), 0, 0, _noAddrs(), _noNums(), ""));
    }

    function encodeWithdraw(uint64 productId, bytes32 requestId, address[] memory adapters, uint256[] memory amounts)
        internal pure returns (bytes memory)
    {
        return abi.encode(Envelope(ADAPTER_WITHDRAW, productId, requestId, 0, WITHDRAW_REBALANCE, address(0), address(0), 0, 0, adapters, amounts, ""));
    }

    /// @notice Release order for redeem funding, symmetric to ADAPTER_SUPPLY. Carries only the expected payout;
    ///         the receiving chain releases according to its own localShareBps.
    function encodeWithdrawPayout(uint64 productId, bytes32 requestId, uint256 payoutNeeded)
        internal pure returns (bytes memory)
    {
        return abi.encode(Envelope(ADAPTER_WITHDRAW, productId, requestId, 0, WITHDRAW_PAYOUT, address(0), address(0), payoutNeeded, 0, _noAddrs(), _noNums(), ""));
    }

    /// @dev nonce is monotonic per sending chain; the receiver compares it against the latest per (vault, who)
    ///      and drops out-of-order deliveries. grant/revoke assign state rather than increment, so a global
    ///      counter with per-target comparison is sufficient.
    function encodeWhitelist(uint64 productId, address vaultAddress, address who, uint8 action, uint256 nonce)
        internal pure returns (bytes memory)
    {
        return abi.encode(Envelope(WHITELIST_SYNC, productId, 0, 0, action, who, vaultAddress, 0, nonce, _noAddrs(), _noNums(), ""));
    }

    function encodeSyncAllocation(uint64 productId, uint256 weightsVersion, uint16 localShareBps, address[] memory adapters, uint16[] memory weightBps)
        internal pure returns (bytes memory)
    {
        uint256[] memory nums = new uint256[](weightBps.length);
        for (uint256 i = 0; i < weightBps.length; i++) nums[i] = weightBps[i];
        return abi.encode(Envelope(ALLOCATION_SYNC, productId, 0, 0, 0, address(0), address(0), 0, (weightsVersion << 16) | localShareBps, adapters, nums, ""));
    }

    // --- decode ---

    function decode(bytes memory m) internal pure returns (Envelope memory p) { p = abi.decode(m, (Envelope)); }

    /// @dev kind 4 data: per-source valuations (second-level decode).
    function decodeValuations(bytes memory data) internal pure returns (AdapterValuation[] memory vals)
    { vals = abi.decode(data, (AdapterValuation[])); }

    /// @dev kind 5 data: approved items (second-level decode).
    function decodeSettleItems(bytes memory data) internal pure returns (SettleItem[] memory deposits, SettleItem[] memory redeems)
    { (deposits, redeems) = abi.decode(data, (SettleItem[], SettleItem[])); }

    /// @dev kind 10 aux unpack: (weightsVersion, localShareBps).
    function unpackAllocation(uint256 aux) internal pure returns (uint256 weightsVersion, uint16 localShareBps)
    { weightsVersion = aux >> 16; localShareBps = uint16(aux); }
}
