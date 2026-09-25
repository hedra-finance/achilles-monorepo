// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import { WireCodec } from "../../bridge/WireCodec.sol";
import { HubRouter } from "../HubRouter.sol";
import { ISettlementLedger } from "../../interfaces/ISettlementLedger.sol";
import { IProductRegistry } from "../../interfaces/IProductRegistry.sol";
import { LedgerStorage } from "./LedgerStorage.sol";
import { LedgerBase } from "./LedgerBase.sol";

/// @title  IntakeFacet — request queuing, rebalance, allocation push and admin (owns the shared view selectors)
/// @notice Request/operations facet of the HubLedger diamond. State is shared through LedgerStorage.
contract IntakeFacet is LedgerBase {
    /// @notice One-time wiring, called right after the diamond cut.
    function init(address orchestrator_, address investments_, address trancheSystem_) external {
        LedgerStorage.Layout storage s = _s();
        if (address(s.orchestrator) != address(0)) revert AlreadyInitialized();
        s.orchestrator = HubRouter(orchestrator_);
        s.investments = ISettlementLedger(investments_);
        s.trancheSystem = IProductRegistry(trancheSystem_);
        s.lastAccrue = uint64(block.timestamp);
        s.reentrancy = 1;
    }

    function setProductId(uint64 pid) external onlyOwner { _s().productId = pid; emit ProductIdSet(pid); }
    /// @notice Push allocation weights (tag 10): the hub sets the canonical weights and refreshes the spoke's LocalAllocation cache.
    function pushAllocation(uint64 chainId, uint256 weightsVersion, uint16 localShareBps, address[] calldata adapters_, uint16[] calldata weightBps_) external onlyOwner {
        _s().orchestrator.sendMessage(_s().productId, chainId, 0, WireCodec.encodeSyncAllocation(_s().productId, weightsVersion, localShareBps, adapters_, weightBps_));
        emit AllocationPushed(chainId, weightsVersion, localShareBps);
    }
    function onDepositReq(uint64 srcChain, uint256 attachedAmount, bytes calldata message) external onlyOrchestrator nonReentrant {
        WireCodec.Envelope memory pl = WireCodec.decode(message);
        uint8 tranche = _trancheIndexOf(pl.vault); // the wire carries no tranche index — derived from (chain, vault)

        // Round that will process this request = the sid the next settle() confirms. _settle() increments
        // the counter before recording (0 = genesis, first real round = 1), so this is always +1 whether
        // or not a collection is in progress.
        uint256 sidFor = _s().settlementId + 1;
        _s().investments.record_investment_request(_s().productId, pl.requestId, sidFor, srcChain, pl.vault, pl.account, pl.amount, 1);
        if (_s().collecting) {
            _s().pendingNext.push(LedgerStorage.PendingReq(pl.requestId, srcChain, tranche, pl.account, pl.amount, 1));
            _s().pendingDepositAssetsNext += pl.amount;
        } else {
            _s().pending.push(LedgerStorage.PendingReq(pl.requestId, srcChain, tranche, pl.account, pl.amount, 1));
            _s().pendingDepositAssets += pl.amount; // allocated but no shares minted yet — excluded from NAV
        }
        // Fix the allocation plan first (no funds move) so the planned split in the event matches the approval record.
        _planDeposit(pl.requestId, pl.amount); // separate stack frame
        // Normally dispatch immediately; during collection the funds stay in the router until after settlement.
        // Held funds are router balance and appear in no chain's NAV, so unconfirmed deposits cannot inflate
        // this round's price. (Held amount = pendingDepositAssetsNext — dispatched as is on promotion.)
        if (!_s().collecting) _executeDeposit(pl.requestId);
        // Allocation snapshot = the chains this request is dispatched to, but the event carries spokes only
        // (hub excluded, same convention as SettleStarted). depAllocOf keeps the hub entry for the approval
        // record (Allocation[]); only the adapterChainIds output is filtered.
        LedgerStorage.AllocSnap[] storage snap = _s().depAllocOf[pl.requestId];
        uint64[] memory adapterChainIds = new uint64[](snap.length);
        uint64 hubId = _hubChainId();
        uint256 nChains;
        for (uint256 i = 0; i < snap.length; i++) {
            if (snap[i].chainId == hubId) continue;
            adapterChainIds[nChains++] = snap[i].chainId;
        }
        assembly { mstore(adapterChainIds, nChains) }
        emit DepositQueued(pl.requestId, srcChain, pl.vault, pl.account, pl.amount, sidFor, _s().collecting, adapterChainIds);
    }
    /// @dev Compute the allocation plan — no funds move, the plan is fixed in depAllocOf (executed by _executeDeposit).
    ///      Each chain's share = request total × pallet weight; the hub takes whatever remains after the spokes.
    ///      The source chain is treated like any other chain, so there is a single code path. One entry per
    ///      chain keeps adapterChainIds unique.
    function _planDeposit(bytes32 requestId, uint256 amount) internal {
        (uint64[] memory spokes, uint16[] memory ws) = _spokes();
        uint256 remaining = amount;
        for (uint256 i = 0; i < spokes.length; i++) {
            if (ws[i] == 0) continue;
            uint256 amt = amount * ws[i] / 10_000;
            if (amt > remaining) amt = remaining;
            if (amt == 0) continue;
            _s().depAllocOf[requestId].push(LedgerStorage.AllocSnap(spokes[i], amt));
            remaining -= amt;
        }
        if (remaining > 0) _s().depAllocOf[requestId].push(LedgerStorage.AllocSnap(_hubChainId(), remaining));
    }
    /// @dev Redemption funding — mirror of `_planDeposit`. Each chain starts releasing its own share.
    ///      The requesting chain already started in requestRedeem (localInitiated); other spokes receive
    ///      kind 8 (flag=PAYOUT) and run the same computation. The hub covers its own share plus estimate
    ///      error and any shortfall of other chains. Realized proceeds are gathered at settlement — spokes
    ///      attach them to kind 4, the hub's initiatePayout credits payoutCollected directly.
    ///      localInitiated is reused as the "already covered" accumulator: another local would be stack too deep.
    /// @dev The returned chains (= adapterChainIds) carry spokes only (hub excluded, same convention as
    ///      SettleStarted). The hub's own initiation (top-up included) still runs; it is only omitted from the event.
    function _planRedeem(bytes32 requestId, uint64 srcChain, uint256 est, uint256 localInitiated)
        internal returns (uint64[] memory chains)
    {
        (uint64[] memory spokes, uint16[] memory ws) = _spokes();
        chains = new uint64[](spokes.length + 1); // upper bound; trimmed to the real length below (spokes only, so +1 is enough)
        uint256 n;
        if (srcChain != _hubChainId()) chains[n++] = srcChain; // inline view call instead of caching hubId — avoids stack too deep
        for (uint256 i = 0; i < spokes.length; i++) {
            if (spokes[i] == srcChain || ws[i] == 0 || est * ws[i] / 10_000 == 0) continue;
            // Send the full expected payout, not the share — the receiving chain applies its own localShareBps.
            _s().orchestrator.sendMessage(_s().productId, spokes[i], 0, WireCodec.encodeWithdrawPayout(_s().productId, requestId, est));
            localInitiated += est * ws[i] / 10_000;
            chains[n++] = spokes[i];
        }
        if (est > localInitiated) {
            _s().payoutCollected += _s().orchestrator.initiatePayout(_s().productId, est - localInitiated); // hub residual top-up — funds move, event omits it
        }
        assembly { mstore(chains, n) } // shrink length in place (unused tail slots are dropped)
    }
    function onRedeemReq(uint64 srcChain, bytes calldata message) external onlyOrchestrator nonReentrant {
        WireCodec.Envelope memory pl = WireCodec.decode(message);
        uint8 tranche = _trancheIndexOf(pl.vault);
        uint256 sidFor = _s().settlementId + 1; // round the next settle() confirms (0 = genesis; same as onDepositReq)
        _s().investments.record_investment_request(_s().productId, pl.requestId, sidFor, srcChain, pl.vault, pl.account, pl.amount, 0);
        if (_s().collecting) _s().pendingNext.push(LedgerStorage.PendingReq(pl.requestId, srcChain, tranche, pl.account, pl.amount, 0));
        else _s().pending.push(LedgerStorage.PendingReq(pl.requestId, srcChain, tranche, pl.account, pl.amount, 0));

        // Settlement-time funding: at request time each chain only starts releasing its share — the spoke
        // its local share (localInitiated), the hub the estimated shortfall here. SYNC proceeds credit
        // payoutCollected immediately; ASYNC ones become tickets swept before settlement. Payout assets are
        // bridged in one batch at settlement (Response gathers, Finalize attaches). Estimate error is absorbed by defer.
        uint256 est = pl.amount * lastPriceOf(tranche) / WAD;
        uint64[] memory adapterChainIds = _planRedeem(pl.requestId, srcChain, est, pl.aux);
        emit RedeemQueued(pl.requestId, srcChain, pl.vault, pl.account, pl.amount, sidFor, _s().collecting, adapterChainIds);
    }
    /// @notice Tell an overweight chain to release funds (rebalance) and push new weights. Proceeds arrive via NET_BRIDGE.
    function rebalanceCrossChain(
        uint64 fromChain, address[] calldata adapters_, uint256[] calldata amounts_, uint64 toChain
    ) external onlyOwner {
        uint256 total;
        for (uint256 i = 0; i < amounts_.length; i++) total += amounts_[i];
        if (_s().rebalanceTo != 0) revert RebalanceActive(); // single in-flight rebalance
        _s().rebalanceTo = toChain;
        _s().rebalanceExpected = total;
        _s().rebalanceCollected = 0;
        _s().orchestrator.sendMessage(_s().productId, fromChain, 0, WireCodec.encodeWithdraw(_s().productId, bytes32(0), adapters_, amounts_));
        emit RebalanceStarted(fromChain, toChain, total);
    }
    /// @notice Book redemption proceeds realized by the hub coordinator — the router has already received
    ///         the assets; only the ledger is updated.
    /// @dev    Not nonReentrant on purpose: the hub coordinator re-enters through this path while
    ///         _startCollect is running. A plain addition with no external call cannot be exploited.
    function creditPayout(uint256 amount) external onlyOrchestrator { _s().payoutCollected += amount; }
    /// @notice Proceeds gathered at the hub (via the router) → re-dispatch as SUPPLY to the underweight chain.
    ///         Partial arrivals (ASYNC releases come in pieces) accumulate and are forwarded as they land.
    ///         Completes when rebalanceExpected is reached. If rebalanceTo == 0 the funds were not part of
    ///         a rebalance and simply stay in the router (admin sweep).
    function onNetBridge(uint64, uint256 amount) external onlyOrchestrator nonReentrant {
        if (_s().rebalanceTo == 0 || amount == 0) return;
        _s().rebalanceCollected += amount;
        _s().orchestrator.sendSupply(_s().productId, _s().rebalanceTo, amount, bytes32(0));
        bool done = _s().rebalanceCollected >= _s().rebalanceExpected;
        emit RebalanceCollected(amount, _s().rebalanceCollected, done);
        if (done) {
            _s().rebalanceTo = 0;
            _s().rebalanceExpected = 0;
            _s().rebalanceCollected = 0;
        }
    }
}
