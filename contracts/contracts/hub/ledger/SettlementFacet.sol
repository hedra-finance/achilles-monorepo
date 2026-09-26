// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import { WireCodec } from "../../bridge/WireCodec.sol";
import { CapitalAllocator } from "../../spoke/CapitalAllocator.sol";
import { ISettlementLedger } from "../../interfaces/ISettlementLedger.sol";
import { IProductRegistry } from "../../interfaces/IProductRegistry.sol";
import { AllocatorRegistry } from "../../libraries/AllocatorRegistry.sol";
import { ValuationRecords } from "../../libraries/ValuationRecords.sol";
import { LedgerStorage } from "./LedgerStorage.sol";
import { LedgerBase } from "./LedgerBase.sol";

/// @dev Net cash of the hub coordinator — the same two values a spoke reports in its NAV response.
///      The pallet registers the chain's router, and the router names the coordinator that holds the
///      per-product ledger, so the address to ask is resolved through one hop.
interface IHubManagerCash {
    function coordinator() external view returns (address);
    function poolCash(uint64 productId) external view returns (uint256);
    function owedAssets(uint64 productId) external view returns (uint256);
}

/// @title  SettlementFacet — collection and settlement pipeline (waterfall, batch approval, recording, finalize messages)
/// @notice Settlement facet of the HubLedger diamond. State is shared through LedgerStorage.
contract SettlementFacet is LedgerBase {
    uint256 internal constant SETTLE_CHUNK = 2; // max SettleItems per message (keeps the fee envelope within the bridge limit)
    /// @dev How long a collection may stay open before tryUpdateNAV treats it as dead and reopens it.
    ///      Observed healthy rounds close in about two minutes; this is several times that, so it can only
    ///      fire on a round that lost a message.
    uint256 internal constant STALE_COLLECT = 5 minutes;
    struct ApprovalBuf {
        ISettlementLedger.InvestmentApprovalInput[] items; uint256 n;   // pallet batch record
        ApprovedItem[] deps; uint256 nd;              // DepositsApproved event
        ApprovedItem[] reds; uint256 nr;              // RedeemsApproved event
        uint8 jr;                                     // last rank (residual tranche) — branch for rated principal tracking
    }

    /// @notice Start a settlement round: snapshot the hub NAV and ask every spoke for theirs.
    ///         Permissionless — the keeper calls it on the product's cadence.
    /// @dev    A round that has been open longer than STALE_COLLECT is abandoned and reopened instead of
    ///         refused. A collection waits on bridge messages, and the relayer drops one often enough that
    ///         "collecting forever" was the normal failure: the keeper skips every cycle, settlement stops
    ///         at whatever id it reached, and only an owner forceUpdateNAV moved it again. A healthy round
    ///         settles in about two minutes, so the threshold is far above anything legitimate, and the
    ///         restart is the same one forceUpdateNAV performs — safe now that a reopened round clears the
    ///         valuation buffer it inherits.
    function tryUpdateNAV() external nonReentrant {
        if (_s().collecting) {
            if (block.timestamp < uint256(_s().collectStartedAt) + STALE_COLLECT) revert AlreadyCollecting();
            _s().collecting = false;
            emit CollectAborted(_s().settlementId + 1); // the round being abandoned, same label the retry will use
        }
        _startCollect();
    }
    /// @notice Force a new round (owner) — resets a collection stuck on a lost response and starts again
    ///         (abortCollect + tryUpdateNAV in one call).
    function forceUpdateNAV() external onlyOwner nonReentrant {
        _s().collecting = false;
        _startCollect();
    }
    function _startCollect() internal {
        _s().collecting = true;
        _s().collectStartedAt = uint64(block.timestamp);
        // Products without a hub allocator (spoke-only capital) skip every hub term — the router's
        // sweepPayout/_hubAdapterAddr revert when unregistered, so the call itself must be avoided.
        if (_adapterOfChain(_hubChainId()) != address(0)) _s().payoutCollected += _s().orchestrator.sweepPayout(_s().productId); // collect ready hub ASYNC payout tickets
        uint256 hubNavAtStart = _hubNavOrZero(); // for the event only — the final number is re-measured at settlement
        _s().navReceivedCount = 0;
        // The buffer belongs to the round, so it has to be dropped here and not only after a settlement:
        // a round that never settles (abortCollect, forceUpdateNAV) otherwise leaves its responses behind and
        // the next round appends a second entry for the same chain. The merged record then carries that chain
        // twice, the pallet rejects the duplicate, and the round's valuations are lost (AdapterValsSkipped).
        delete _s().navValsBuf;
        (uint64[] memory spokes, ) = _spokes(); // collection targets = every spoke registered in the pallet (hub is measured locally)
        _s().navExpected = spokes.length;
        _sendCollect(spokes);
        // settlementId + 1 = the round this collection will confirm (same labeling as DepositQueued/RedeemQueued sidFor and Settled).
        emit SettleStarted(_s().settlementId + 1, hubNavAtStart, spokes, _finalizeTargets(spokes, false)); // event lists cross-chain targets only (hub excluded)
        if (spokes.length == 0) _settle();
    }
    /// @dev Send the collect request with the last confirmed prices (separate stack frame).
    ///      If a hub coordinator is registered it also receives the message: no NAV response is expected
    ///      (the hub measures its own NAV, and a synchronous response would re-enter) — it only refreshes
    ///      the price cache, and local delivery costs no bridge fee.
    ///      The COLLECT_NAV payload carries settlementId + 1 (the round being confirmed), matching
    ///      SettleStarted; onNavResponse compares against the same +1 value.
    function _sendCollect(uint64[] memory spokes) internal {
        uint8 tc = trancheCount();
        uint256[] memory lastPrices = new uint256[](tc);
        for (uint8 t = 0; t < tc; t++) lastPrices[t] = lastPriceOf(t); // refreshes the spoke price cache
        uint256 sidFor = _s().settlementId + 1;
        for (uint256 i = 0; i < spokes.length; i++) {
            _s().navReceived[spokes[i]] = false;
            _s().orchestrator.sendMessage(_s().productId, spokes[i], 0, WireCodec.encodeCollectNav(_s().productId, sidFor, lastPrices));
        }
        uint64 hubId = _hubChainId();
        if (_s().orchestrator.managerOf(_s().productId, hubId) != address(0)) {
            _s().orchestrator.sendMessage(_s().productId, hubId, 0, WireCodec.encodeCollectNav(_s().productId, sidFor, lastPrices));
        }
    }
    /// @dev Finalize targets = chains with requests in the pending queue (deduplicated, fixed at collection start).
    ///      Hub vault requests go out via local delivery, so the hub is a candidate for the send loop, but
    ///      SettleStarted lists spokes only (includeHub=false: finalizeChainIds = cross-chain messaging targets).
    ///      COLLECT also goes to the hub but no NAV response is taken from it (the hub measures itself; the hub
    ///      coordinator's poolCash and owedAssets net out so it is NAV-neutral).
    function _finalizeTargets(uint64[] memory spokes, bool includeHub) internal view returns (uint64[] memory finalizeChainIds) {
        uint64[] memory finTmp = new uint64[](spokes.length + 1);
        uint256 nFin;
        for (uint256 i = 0; i < spokes.length; i++) {
            for (uint256 j = 0; j < _s().pending.length; j++) {
                if (_s().pending[j].srcChain == spokes[i]) { finTmp[nFin++] = spokes[i]; break; }
            }
        }
        if (includeHub) {
            uint64 hubId = _hubChainId();
            for (uint256 j = 0; j < _s().pending.length; j++) {
                if (_s().pending[j].srcChain == hubId) { finTmp[nFin++] = hubId; break; }
            }
        }
        finalizeChainIds = new uint64[](nFin);
        for (uint256 i = 0; i < nFin; i++) finalizeChainIds[i] = finTmp[i];
    }
    function onNavResponse(uint64 srcChain, uint256 attachedAmount, bytes calldata message) external onlyOrchestrator nonReentrant {
        WireCodec.Envelope memory pl = WireCodec.decode(message); // productId was consumed by the router for routing
        // A response can outlive its round: the round settled without it, or tryUpdateNAV abandoned a round
        // whose messages the relayer had dropped and the relayer delivered them afterwards. Reverting here
        // would fail the bridge delivery itself and strand the assets riding along, so a late response is
        // treated exactly like one for a different round — its proceeds are booked, its NAV ignored.
        if (!_s().collecting) { _s().payoutCollected += pl.aux; return; }
        uint256 chainNav = pl.amount;
        attachedAmount; // the fee sponsor covers any gap between declared and received; accounting uses the declared value
        // Attached redemption proceeds are always booked on physical arrival (even for a late response the
        // assets are in the router), but only inside the duplicate guard to avoid double counting. A response
        // for a different round contributes assets only, not NAV. The comparison uses +1 to match _sendCollect's sidFor.
        if (pl.settlementId != _s().settlementId + 1) { _s().payoutCollected += pl.aux; return; }
        if (!_s().navReceived[srcChain]) {
            _s().navReceived[srcChain] = true;
            _s().navOf[srcChain] = chainNav;
            _s().navReceivedCount++;
            _s().payoutCollected += pl.aux; // inside the guard so a duplicate response is not counted twice
            // In-transit accounting — cumulative received as reported by the spoke (empty array = legacy spoke → assume everything landed)
            _s().supplyRecvCum[srcChain] = pl.nums.length > 0 ? pl.nums[0] : _s().supplySentCum[srcChain];
            // Buffer instead of writing to the pallet now: one write per sid is allowed, so the merged record happens in _settle.
            // pl.data = abi.encode(AdapterValuation[]) buffered as is (64 bytes = empty array).
            if (pl.data.length > 64) _s().navValsBuf.push(pl.data);
            emit NavReceived(_s().settlementId + 1, srcChain, chainNav); // same round label as SettleStarted
        }
        if (_s().navReceivedCount == _s().navExpected) _settle(); // spokes that never respond roll into the next round; all are expected to respond
    }
    /// @notice Clear a stuck collection (owner) — resets collecting so tryUpdateNAV can be fired again.
    function abortCollect() external onlyOwner { _s().collecting = false; emit CollectAborted(_s().settlementId + 1); } // round the aborted collection would have confirmed
    function _settle() internal {
        // Fix the sid before anything of this round is written (pallet record_*, approval events, spoke
        // dispatch). 0 is genesis; real rounds start at 1. Same pre-increment as the single-chain valuation.
        _s().settlementId += 1;
        // Product NAV = Σ chain NAV − pending exclusion (GAV → NAV adjustment).
        // The hub NAV is re-measured here rather than taken from the collection-start snapshot: within the
        // window, payout funding moves funds from the hub allocator to the router, and a snapshot would count
        // that money twice (old allocator value + payoutCollected), inflating the price. Deposit funds are not
        // dispatched during collection (held in the router), so they do not leak into this measurement.
        uint256 gross = _hubNavOrZero() + _s().payoutCollected; // 0 for hub-less products; gathered proceeds are product assets held by the router
        // Net cash held by the hub coordinator. It does not send itself a NAV response and only forwards
        // pre-released proceeds to the router when tag 3 arrives, so proceeds of redemptions that arrive after
        // collection opened sit inside the coordinator until the next round's tag 3. They are in neither the
        // allocator NAV nor payoutCollected, and without this term they vanish from the round's NAV with the
        // loss landing entirely on the residual tranche. Same formula the spokes use in their response. Funds
        // already forwarded left poolCash and moved to payoutCollected, so nothing is counted twice.
        uint64 hubId = _hubChainId();
        address hubMgr = _s().orchestrator.managerOf(_s().productId, hubId);
        if (hubMgr != address(0)) {
            address coord = IHubManagerCash(hubMgr).coordinator();
            uint256 cash = IHubManagerCash(coord).poolCash(_s().productId);
            uint256 owed = IHubManagerCash(coord).owedAssets(_s().productId);
            if (cash > owed) gross += cash - owed;
        }
        (uint64[] memory spokes, ) = _spokes();
        for (uint256 i = 0; i < spokes.length; i++) {
            gross += _s().navOf[spokes[i]];
            // Deposit allocations still on the bridge = cumulative sent − cumulative received (as reported at
            // measurement time). Without this term the assets vanish from NAV while pendingDepositAssets is
            // still deducted, depressing the round's price.
            uint256 sent = _s().supplySentCum[spokes[i]];
            uint256 recv = _s().supplyRecvCum[spokes[i]];
            if (sent > recv) gross += sent - recv;
        }
        uint256 productNav = gross > _s().pendingDepositAssets ? gross - _s().pendingDepositAssets : 0;

        // Sequential waterfall: senior (0) targets first, residual to junior (last). Targets accrue apr over time.
        uint8 tcW = trancheCount();
        _accrueTargets(tcW);
        _computePrices(productNav, tcW); // confirmed prices are written to settlePrice

        // Record (record_* caller = the ledger) — buffered spoke responses merged with the hub's, one write per sid.
        if (!ValuationRecords.mergeAndRecord(address(_s().investments), _s().productId, _s().settlementId, _s().navValsBuf, _adapterOfChain(_hubChainId())))
            emit AdapterValsSkipped(_s().settlementId);
        delete _s().navValsBuf;

        // Approve requests and build per-chain SettleItems → finalize messages (share prices attached for the spoke cache).
        uint64[] memory finTargets = _finalizeTargets(spokes, true); // send loop includes hub vault requests (local delivery)
        ApprovalBuf memory apr = ApprovalBuf(
            new ISettlementLedger.InvestmentApprovalInput[](_s().pending.length), 0,
            new ApprovedItem[](_s().pending.length), 0,
            new ApprovedItem[](_s().pending.length), 0,
            tcW - 1
        );
        for (uint256 s = 0; s < finTargets.length; s++) _dispatchSettle(finTargets[s], apr);
        _flushApprovals(apr);

        uint8 tc = trancheCount();
        for (uint8 t = 0; t < tc; t++) { LedgerStorage.Tranche storage tr = _s().tr[t]; tr.lastPrice = tr.settlePrice; }
        delete _s().pending;
        // Promote requests that arrived during collection to the next round's queue (already recorded under sid+1).
        // Deposits held in the router are dispatched now, per their fixed plan — after this round's pricing,
        // so the funds do not mix into this round's NAV.
        for (uint256 i = 0; i < _s().pendingNext.length; i++) {
            _s().pending.push(_s().pendingNext[i]);
            if (_s().pendingNext[i].orderType == 1) _executeDeposit(_s().pendingNext[i].requestId);
        }
        delete _s().pendingNext;
        _s().pendingDepositAssets = _s().pendingDepositAssetsNext;
        _s().pendingDepositAssetsNext = 0;
        // Tranche settlement record = post-settlement snapshot: unitsOf after approvals/mint/burn,
        // pending = carried-over remainder, tranche_nav = price × units.
        uint256 productNavPost = _recordTrancheSettlement();
        _s().collecting = false;
        // The event mirrors the pallet record (post-settlement snapshot, per tranche price × units) so newly
        // approved deposits show up in tranche NAV immediately; waterfall intermediates are never exposed.
        _emitSettled(productNavPost, tc); // separate stack frame
    }
    function _emitSettled(uint256 productNavPost, uint8 tc) internal {
        uint8 jrT = tc - 1;
        emit Settled(
            _s().settlementId,
            productNavPost,
            (_s().tr[0].settlePrice * _s().tr[0].units) / WAD,
            tc > 1 ? (_s().tr[jrT].settlePrice * _s().tr[jrT].units) / WAD : 0
        );
    }
    /// @dev Record the post-settlement snapshot (called after approvals, mint/burn and the pending reset).
    ///      units = outstanding after this round, tranche_nav = share_price × units, product_nav = Σ tranche_nav.
    ///      Tranche key = (vault_chain_id, vault_address) — per vault.
    function _recordTrancheSettlement() internal returns (uint256 productNavPost) {
        IProductRegistry.TrancheInput[] memory trs = _tranches(); // chain groups (chain_id asc), priority order within a group (pallet guarantee)
        uint8 jr = trancheCount() - 1;
        WireCodec.TrancheSettle[] memory ts = new WireCodec.TrancheSettle[](trs.length);
        uint64 curChain; uint8 lt;
        for (uint256 i = 0; i < trs.length; i++) {
            if (i == 0 || trs[i].vault.chain_id != curChain) { curChain = trs[i].vault.chain_id; lt = 0; } // group boundary = rank reset
            LedgerStorage.Tranche storage tr = _s().tr[lt];
            address va = trs[i].vault.vault_address;
            uint256 u = _s().unitsOfVault[va];
            uint256 tnav = (tr.settlePrice * u) / WAD;
            productNavPost += tnav;
            ts[i] = WireCodec.TrancheSettle({
                vault_chain_id: curChain,
                vault_address: va,
                tranche_nav: tnav,
                share_price: tr.settlePrice, // vaults of the same logical tranche (rank) share one price
                units_outstanding: u,
                // rated principal is tracked per logical tranche — prorated by vault units so the sum is preserved
                principal: (lt < jr && tr.units > 0) ? tr.principal * u / tr.units : 0
            });
            lt++;
        }
        // Pallet writes do not roll back on EVM revert — a retry of a partially recorded sid would revert as a
        // duplicate and wedge settlement, so the failure is non-fatal.
        try _s().investments.record_settlement(_s().productId, _s().settlementId, ts, _s().pendingDepositAssets, productNavPost) {}
        catch { emit TrancheSettlementSkipped(_s().settlementId); }
    }
    /// @dev Accrue the targets of rated tranches (rank < jr) by their apr, time-proportional (compounding per settle).
    ///      New deposits accrue for the full interval from the next settle onward (deposit timestamp ignored) — an approximation.
    function _accrueTargets(uint8 tc) internal {
        uint256 dt = block.timestamp - _s().lastAccrue;
        if (dt > 0 && tc > 1) {
            uint256[] memory aprs = AllocatorRegistry.trancheAprs(address(_s().trancheSystem), _s().productId);
            for (uint8 t = 0; t + 1 < tc; t++) {
                LedgerStorage.Tranche storage tr = _s().tr[t];
                if (aprs[t] > 0 && tr.target > 0) tr.target += (tr.target * aprs[t] * dt) / (WAD * YEAR);
            }
        }
        _s().lastAccrue = uint64(block.timestamp);
    }
    /// @dev N-level sequential waterfall — rated tranches take min(target, remaining) in rank order; the last (junior) takes the rest.
    function _computePrices(uint256 productNav, uint8 tc) internal {
        uint256 rem = productNav;
        uint8 jr = tc - 1;
        for (uint8 t = 0; t < jr; t++) {
            LedgerStorage.Tranche storage tr = _s().tr[t];
            uint256 nav = tr.target < rem ? tr.target : rem;
            rem -= nav;
            tr.settlePrice = tr.units == 0 ? WAD : (nav * WAD) / tr.units;
        }
        LedgerStorage.Tranche storage jt = _s().tr[jr];
        jt.settlePrice = jt.units == 0 ? WAD : (rem * WAD) / jt.units;
    }
    function _dispatchSettle(uint64 chainId, ApprovalBuf memory apr) internal {
        (WireCodec.SettleItem[] memory deps, WireCodec.SettleItem[] memory reds) = _buildItems(chainId, apr);
        uint256 total = deps.length + reds.length;
        if (total == 0) return;
        uint8 tc = trancheCount();
        uint256[] memory prices = new uint256[](tc);
        for (uint8 t = 0; t < tc; t++) prices[t] = _s().tr[t].settlePrice;
        // Total payout for this chain (approved items only — budget check and consumption happen in _approveRedeem, so CLAIMABLE is always fundable)
        uint256 chainPayout;
        for (uint256 i = 0; i < reds.length; i++) chainPayout += reds[i].amount;
        for (uint256 off = 0; off < total; off += SETTLE_CHUNK) {
            _sendSettleChunk(chainId, deps, reds, off, prices, off == 0 ? chainPayout : 0); // payout attached to the first chunk only
        }
    }
    /// @dev Send one finalize message with the items in [off, off+SETTLE_CHUNK) (global index: deps first, then reds).
    function _sendSettleChunk(uint64 chainId, WireCodec.SettleItem[] memory deps, WireCodec.SettleItem[] memory reds, uint256 off, uint256[] memory prices, uint256 payoutAmount) internal {
        uint256 total = deps.length + reds.length;
        uint256 end = off + SETTLE_CHUNK < total ? off + SETTLE_CHUNK : total;
        uint256 nd; uint256 nr;
        for (uint256 i = off; i < end; i++) { if (i < deps.length) nd++; else nr++; }
        WireCodec.SettleItem[] memory d = new WireCodec.SettleItem[](nd);
        WireCodec.SettleItem[] memory r = new WireCodec.SettleItem[](nr);
        uint256 di; uint256 ri;
        for (uint256 i = off; i < end; i++) {
            if (i < deps.length) d[di++] = deps[i]; else r[ri++] = reds[i - deps.length];
        }
        _emitSettleMsg(chainId, d, r, prices, payoutAmount);
    }
    function _emitSettleMsg(uint64 chainId, WireCodec.SettleItem[] memory d, WireCodec.SettleItem[] memory r, uint256[] memory prices, uint256 payoutAmount) internal {
        _s().orchestrator.sendMessage(_s().productId, chainId, payoutAmount, WireCodec.encodeSettleDistribute(_s().productId, _s().settlementId, d, r, prices, payoutAmount));
    }
    function _buildItems(uint64 chainId, ApprovalBuf memory apr)
        internal returns (WireCodec.SettleItem[] memory deps, WireCodec.SettleItem[] memory reds)
    {
        uint256 nDep; uint256 nRed;
        for (uint256 i = 0; i < _s().pending.length; i++) {
            if (_s().pending[i].srcChain != chainId) continue;
            if (_s().pending[i].orderType == 1) nDep++; else nRed++;
        }
        deps = new WireCodec.SettleItem[](nDep);
        reds = new WireCodec.SettleItem[](nRed);
        uint256 di; uint256 ri;
        for (uint256 i = 0; i < _s().pending.length; i++) {
            if (_s().pending[i].srcChain != chainId) continue;
            if (_s().pending[i].orderType == 1) {
                deps[di++] = _approveDeposit(_s().pending[i], apr);
            } else {
                (WireCodec.SettleItem memory item, bool ok) = _approveRedeem(_s().pending[i], apr);
                if (ok) reds[ri++] = item; // deferred redemptions are excluded (moved to pendingNext)
            }
        }
        assembly { mstore(reds, ri) } // shrink by the number of deferred items
    }
    function _approveDeposit(LedgerStorage.PendingReq memory p, ApprovalBuf memory apr) internal returns (WireCodec.SettleItem memory) {
        LedgerStorage.Tranche storage tr = _s().tr[p.tranche];
        uint256 shares = (p.amount * WAD) / tr.settlePrice;
        tr.units += shares;
        _s().unitsOfVault[_vaultOf(p.tranche, p.srcChain)] += shares; // per-vault attribution (for the pallet record)
        if (p.tranche < apr.jr) { tr.principal += p.amount; tr.target += p.amount; } // rated principal and target
        _bufferApproval(apr, p.requestId, p.amount, shares);
        apr.deps[apr.nd++] = ApprovedItem(p.requestId, p.amount, shares, tr.settlePrice);
        return WireCodec.SettleItem(p.requestId, p.controller, shares);
    }
    function _bufferApproval(ApprovalBuf memory apr, bytes32 requestId, uint256 amount, uint256 claimable) internal {
        ISettlementLedger.Allocation[] memory alloc = _buildAlloc(requestId, amount); // separate stack frame
        apr.items[apr.n++] = ISettlementLedger.InvestmentApprovalInput(requestId, alloc, claimable);
        delete _s().depAllocOf[requestId];
    }
    function _flushApprovals(ApprovalBuf memory apr) internal {
        if (apr.n == 0) return;
        ISettlementLedger.InvestmentApprovalInput[] memory items = apr.items;
        ApprovedItem[] memory deps = apr.deps;
        ApprovedItem[] memory reds = apr.reds;
        uint256 n = apr.n; uint256 nd = apr.nd; uint256 nr = apr.nr;
        assembly { mstore(items, n) mstore(deps, nd) mstore(reds, nr) } // shrink by the number of deferred redemptions
        _s().investments.record_investment_approvals(_s().productId, _s().settlementId, items);
        if (nd > 0) emit DepositsApproved(_s().settlementId, deps);
        if (nr > 0) emit RedeemsApproved(_s().settlementId, reds);
    }
    function _buildAlloc(bytes32 requestId, uint256 amount) internal view returns (ISettlementLedger.Allocation[] memory alloc) {
        LedgerStorage.AllocSnap[] storage snap = _s().depAllocOf[requestId];
        if (snap.length > 0) {
            alloc = new ISettlementLedger.Allocation[](snap.length);
            for (uint256 i = 0; i < snap.length; i++) {
                address ad = _adapterOfChain(snap[i].chainId); // pallet-registered allocator (fallback for unregistered chains)
                alloc[i] = ISettlementLedger.Allocation(ad == address(0) ? _fallbackAdapter() : ad, snap[i].chainId, snap[i].amount);
            }
        } else {
            alloc = new ISettlementLedger.Allocation[](1);
            (address fad, uint64 fcid) = _fallbackAlloc();
            alloc[0] = ISettlementLedger.Allocation(fad, fcid, amount);
        }
    }
    /// @dev Allocation-record fallback, always as a consistent (chain, allocator) pair: (hub, hub allocator)
    ///      when one exists, otherwise (first spoke, its allocator). Swapping only the allocator while keeping
    ///      the chain makes the pallet reject the record with AllocationAdapterNotRegistered.
    function _fallbackAlloc() internal view returns (address ad, uint64 cid) {
        cid = _hubChainId();
        ad = _adapterOfChain(cid);
        if (ad == address(0)) {
            (uint64[] memory spokes, ) = _spokes();
            if (spokes.length > 0) { cid = spokes[0]; ad = _adapterOfChain(cid); }
        }
    }
    function _fallbackAdapter() internal view returns (address) { (address ad, ) = _fallbackAlloc(); return ad; }
    /// @dev Hub chain NAV — 0 for products without a hub allocator (spoke-only capital).
    function _hubNavOrZero() internal view returns (uint256) {
        address hubAd = _adapterOfChain(_hubChainId());
        return hubAd == address(0) ? 0 : CapitalAllocator(hubAd).chainNav();
    }
    /// @dev Approve a redemption: payout = this round's confirmed price, prorated senior principal reduction, burn.
    ///      Payout assets travel with the same round's Finalize (kind 5) to the spoke.
    ///      Budget = payoutCollected (realized, gathered assets). On a shortfall try a hub top-up; if still
    ///      short, defer to the next round without approving — CLAIMABLE must always be fundable.
    function _approveRedeem(LedgerStorage.PendingReq memory p, ApprovalBuf memory apr) internal returns (WireCodec.SettleItem memory item, bool ok) {
        LedgerStorage.Tranche storage tr = _s().tr[p.tranche];
        uint256 priceUsed = tr.settlePrice;
        uint256 assets = (p.amount * priceUsed) / WAD;
        if (assets > _s().payoutCollected && _adapterOfChain(_hubChainId()) != address(0)) {
            // Cover estimate error / unrealized ASYNC with a top-up (SYNC realizes at once and passes this round).
            // Repeated defers may over-release; the surplus stays in payoutCollected for later redemptions.
            // Hub-less products have no source to draw on and wait for spoke aux credits instead.
            _s().payoutCollected += _s().orchestrator.initiatePayout(_s().productId, assets - _s().payoutCollected);
        }
        if (assets > _s().payoutCollected) {
            // Hub-less products fund redemptions only from spoke pre-releases at request-time prices, so a small
            // structural shortfall (price drift, bridge/swap fees) is expected. Within 0.5% the payout is clamped
            // to what was realized (fees absorbed by the payout). Hub products never reach this branch because
            // initiatePayout fills the gap.
            if (_adapterOfChain(_hubChainId()) == address(0) && _s().payoutCollected >= assets - assets / 200) {
                assets = _s().payoutCollected;
            } else {
                _s().pendingNext.push(p); // funds not realized — defer to the next round (re-priced at that round's price)
                emit RedeemDeferred(p.requestId, _s().settlementId, assets);
                return (item, false);
            }
        }
        _s().payoutCollected -= assets; // consume the budget — shipped with Finalize in dispatch
        if (p.tranche < apr.jr && tr.units > 0) {
            uint256 cut = tr.principal * p.amount / tr.units; // reduce principal by the redeemed share fraction
            tr.principal = tr.principal > cut ? tr.principal - cut : 0;
            uint256 tcut = tr.target * p.amount / tr.units;   // and the target proportionally
            tr.target = tr.target > tcut ? tr.target - tcut : 0;
        }
        tr.units -= p.amount;
        address rv = _vaultOf(p.tranche, p.srcChain);
        _s().unitsOfVault[rv] = _s().unitsOfVault[rv] > p.amount ? _s().unitsOfVault[rv] - p.amount : 0;
        _bufferApproval(apr, p.requestId, p.amount, assets); // redeem: original request amount = shares (p.amount)
        apr.reds[apr.nr++] = ApprovedItem(p.requestId, p.amount, assets, priceUsed);
        return (WireCodec.SettleItem(p.requestId, p.controller, assets), true);
    }
}
