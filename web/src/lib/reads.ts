// All on-chain reads — calls the hub precompiles (settlement, requests, permissions) and the spokes (vaults, allocators, pools) directly.
import type { Address, Hex } from 'viem'
import { client, hubClient, hub } from './chains'
import { PRODUCT } from './product'
import {
  PRECOMPILE, trancheSystemAbi, investmentsAbi, permissionsAbi, txRegistryAbi,
  vaultAbi, erc20Abi, basketAdapterAbi, uniV3PoolAbi, lpAdapterAbi, uniV2PoolAbi, adapterNameAbi,
} from './abi'
import { sqrtPriceToWad } from './math'

const pid = PRODUCT.id
const TS = PRECOMPILE.trancheSystem, INV = PRECOMPILE.investments, PERM = PRECOMPILE.permissions, REG = PRECOMPILE.txRegistry

export type Tranche = {
  index: number; type: 'Senior' | 'Junior'; apr: bigint; chainId: number
  vault: Address; asset: Address; share: Address
}
export type Product = {
  baseAsset: Address; valuation: Address; decimals: number
  settlement: { start: number; length: number; offset: number }
  tranches: Tranche[]
  /** Chains that receive capital (allocator weight > 0) */
  depositChains: number[]
}

/** Product configuration — get_product + get_tranches (priority order) + the allocator roster. Static, read once. */
export async function loadProduct(): Promise<Product> {
  const h = hubClient()
  const [[baseAsset, valuation, start, length, offset], tranches, roster] = await Promise.all([
    h.readContract({ address: TS, abi: trancheSystemAbi, functionName: 'get_product', args: [pid] }),
    h.readContract({ address: TS, abi: trancheSystemAbi, functionName: 'get_tranches', args: [pid] }),
    h.readContract({ address: TS, abi: trancheSystemAbi, functionName: 'get_multichain_adapters', args: [pid] }),
  ])
  const ts: Tranche[] = tranches.map((t, i) => ({
    index: i, type: t.tranche_type === 1 ? 'Senior' : 'Junior', apr: t.apr,
    chainId: Number(t.vault.chain_id), vault: t.vault.vault_address, asset: t.asset, share: t.shares,
  }))
  const active = new Set(roster.filter((m) => m.weightBps > 0).map((m) => Number(m.chain_id)))
  const chains = [...new Set(ts.map((t) => t.chainId))]
  const decimals = ts[0] ? Number(await client(ts[0].chainId).readContract({ address: ts[0].asset, abi: erc20Abi, functionName: 'decimals' })) : 6
  return {
    baseAsset, valuation, decimals,
    settlement: { start: Number(start), length: Number(length), offset: Number(offset) },
    tranches: ts,
    depositChains: chains.filter((c) => active.size === 0 || active.has(c)),
  }
}

export type Settlement = { id: number; sharePrices: bigint[]; trancheNavs: bigint[]; productNav: bigint; at: Date | null }

/** Latest finalized settlement — share prices and NAV ordered by tranche. Null if nothing has settled yet. */
export async function lastSettlement(p: Product): Promise<Settlement | null> {
  const h = hubClient()
  const [id, chains, productNav] = await h.readContract({ address: INV, abi: investmentsAbi, functionName: 'get_last_settlement', args: [pid] })
  if (id === 0n) return null
  const byChain = new Map(chains.map((c) => [Number(c.chain_id), c]))
  const seen = new Map<number, number>()
  const sharePrices: bigint[] = [], trancheNavs: bigint[] = []
  for (const t of p.tranches) {
    const i = seen.get(t.chainId) ?? 0
    seen.set(t.chainId, i + 1)
    const c = byChain.get(t.chainId)
    sharePrices.push(c?.share_prices[i] ?? 0n)
    trancheNavs.push(c?.tranche_navs[i] ?? 0n)
  }
  const [, , , , ts] = await h.readContract({ address: INV, abi: investmentsAbi, functionName: 'get_settlement_state', args: [pid, id] })
  return { id: Number(id), sharePrices, trancheNavs, productNav, at: ts ? new Date(Number(ts)) : null }
}

/** The last N settlements, oldest first — the source of truth for the price/TVL chart and yield calculations. Page size capped at 50. */
export async function settlementHistory(p: Product, lastN = 200): Promise<Settlement[]> {
  const h = hubClient()
  const sid = Number(await h.readContract({ address: INV, abi: investmentsAbi, functionName: 'get_settlement_id', args: [pid] }))
  const want = Math.min(sid, lastN)
  const out: Settlement[] = []
  for (let off = 0; off < want; off += 50) {
    const take = Math.min(50, want - off)
    const [entries] = await h.readContract({ address: INV, abi: investmentsAbi, functionName: 'get_settlement_states', args: [pid, BigInt(off), BigInt(take)] })
    for (const e of entries) {
      const byVault = new Map(e.tranches.map((t) => [t.vault_address.toLowerCase(), t]))
      const ord = p.tranches.map((t) => byVault.get(t.vault.toLowerCase()))
      out.push({
        id: Number(e.settlement_id), productNav: e.product_nav,
        sharePrices: ord.map((t) => t?.share_price ?? 0n), trancheNavs: ord.map((t) => t?.tranche_nav ?? 0n),
        at: e.timestamp ? new Date(Number(e.timestamp)) : null,
      })
    }
    if (entries.length < take) break
  }
  return out.reverse()
}

// -- user --

export type RequestKind = 'deposit' | 'redeem'
export type Stage = 'bridging' | 'queued' | 'settlement' | 'receivable' | null
export type TranchePosition = {
  index: number; shares: bigint
  deposit: { pending: bigint; claimable: bigint; stage: Stage }
  redeem: { pending: bigint; claimable: bigint; stage: Stage }
}

/** Per-tranche balance, pending and claimable amounts — from the spoke 7540 views, staged using the hub's request progress. */
export async function position(p: Product, user: Address): Promise<TranchePosition[]> {
  const progs = await activeProgress(user).catch(() => [] as Progress[])
  return Promise.all(p.tranches.map(async (t) => {
    const c = client(t.chainId)
    const v = (fn: 'pendingDepositRequest' | 'claimableDepositRequest' | 'pendingRedeemRequest' | 'claimableRedeemRequest') =>
      c.readContract({ address: t.vault, abi: vaultAbi, functionName: fn, args: [0n, user] })
    const [shares, pd, cd, pr, cr] = await Promise.all([
      c.readContract({ address: t.share, abi: erc20Abi, functionName: 'balanceOf', args: [user] }),
      v('pendingDepositRequest'), v('claimableDepositRequest'), v('pendingRedeemRequest'), v('claimableRedeemRequest'),
    ])
    const stage = (kind: RequestKind, pending: bigint, claimable: bigint): Stage => {
      if (claimable > 0n) return 'receivable'
      if (pending === 0n) return null
      const pr = progs.find((x) => x.kind === kind && x.vault.toLowerCase() === t.vault.toLowerCase())
      return !pr ? 'queued' : pr.settled ? 'settlement' : pr.status === 'Completed' ? 'queued' : 'bridging'
    }
    return {
      index: t.index, shares,
      deposit: { pending: pd, claimable: cd, stage: stage('deposit', pd, cd) },
      redeem: { pending: pr, claimable: cr, stage: stage('redeem', pr, cr) },
    }
  }))
}

export async function canDeposit(p: Product, user: Address, trancheIdx = 0): Promise<boolean> {
  const t = p.tranches[trancheIdx]
  return hubClient().readContract({
    address: PERM, abi: permissionsAbi, functionName: 'is_tranche_investor',
    args: [pid, { chain_id: BigInt(t.chainId), vault_address: t.vault }, user],
  })
}

export async function assetBalances(p: Product, user: Address): Promise<Record<number, bigint>> {
  const out: Record<number, bigint> = {}
  await Promise.all([...new Set(p.tranches.map((t) => t.chainId))].map(async (cid) => {
    const t = p.tranches.find((x) => x.chainId === cid)!
    out[cid] = await client(cid).readContract({ address: t.asset, abi: erc20Abi, functionName: 'balanceOf', args: [user] })
  }))
  return out
}

// -- request progress (hub request registry) --

export type TxStep = { step: number; label: string; done: boolean; failed?: boolean; txHash: Hex | null; chainId: number | null; at: Date | null }
export type Progress = {
  requestId: Hex; kind: RequestKind; vault: Address; vaultChainId: number; amount: bigint
  status: 'Requested' | 'Completed'; settlementId: bigint; settled: boolean
  phase: 'processing' | 'awaiting' | 'settling' | 'receivable'
  steps: TxStep[]; legs: { chainId: number; steps: TxStep[] }[]
}
const DEPOSIT_STEPS: Record<number, string> = { 1: 'Requested', 2: 'Bridged to hub', 3: 'Queued for settlement', 4: 'Sent to yield source', 5: 'Supplied', 6: 'Completed' }
const REDEEM_STEPS: Record<number, string> = { 1: 'Requested', 2: 'Bridged to hub', 3: 'Queued for settlement', 4: 'Funds recalled', 5: 'Recall applied', 6: 'Completed' }
export const SETTLE_STEPS: Record<number, string> = {
  0: 'Queued', 1: 'Settlement started', 2: 'NAV request sent', 3: 'NAV reported', 4: 'NAV returned', 5: 'NAV confirmed',
  6: 'Requests approved', 7: 'Finalize sent', 8: 'Finalize applied', 9: 'Settled',
}

const blockTimes = new Map<bigint, Date>()
async function loadBlockTimes(nums: Iterable<bigint>) {
  await Promise.all([...new Set(nums)].filter((n) => n !== 0n && !blockTimes.has(n)).map(async (n) => {
    const b = await hubClient().getBlock({ blockNumber: n }).catch(() => null)
    if (b) blockTimes.set(n, new Date(Number(b.timestamp) * 1000))
  }))
}
type RawStep = { step: number; tx: { chain_id: bigint; tx_hash: Hex; recorded_at: bigint } }
type RawAttempt = { status: number; tx: { chain_id: bigint; tx_hash: Hex; recorded_at: bigint } }
function decodeSteps(steps: readonly RawStep[], labels: Record<number, string>): TxStep[] {
  return steps.map((s) => ({
    step: s.step, label: labels[s.step] ?? `Step ${s.step}`, done: s.tx.recorded_at !== 0n,
    txHash: s.tx.recorded_at !== 0n ? s.tx.tx_hash : null,
    chainId: s.tx.recorded_at !== 0n ? Number(s.tx.chain_id) : null,
    at: blockTimes.get(s.tx.recorded_at) ?? null,
  }))
}
/** Marks an unreached bridge step with its latest rollback attempt (status 4 = Reverted). */
function applyAttempts(step: TxStep | undefined, attempts: readonly RawAttempt[]) {
  if (!step || step.done || attempts.length === 0) return
  const last = attempts[attempts.length - 1]
  if (last.status === 4) { step.failed = true; step.txHash = last.tx.tx_hash; step.chainId = Number(last.tx.chain_id); step.at = blockTimes.get(last.tx.recorded_at) ?? null }
}
const stepBlocks = (steps: readonly RawStep[]) => steps.filter((s) => s.tx.recorded_at !== 0n).map((s) => s.tx.recorded_at)

export async function requestsProgress(ids: readonly Hex[]): Promise<Progress[]> {
  if (ids.length === 0) return []
  const h = hubClient()
  const out: Progress[] = []
  for (let i = 0; i < ids.length; i += 50) {
    const entries = await h.readContract({ address: REG, abi: txRegistryAbi, functionName: 'get_requests', args: [pid, ids.slice(i, i + 50) as Hex[]] })
    const nums: bigint[] = []
    for (const e of entries) { nums.push(...stepBlocks(e.request_steps)); for (const l of e.adapter_legs) nums.push(...stepBlocks(l.steps)); nums.push(...e.request_bridge_attempts.map((a) => a.tx.recorded_at)) }
    await loadBlockTimes(nums)
    for (const e of entries) {
      if (!e.found) continue
      const kind: RequestKind = Number(e.info.order_type) === 1 ? 'deposit' : 'redeem'
      const labels = kind === 'deposit' ? DEPOSIT_STEPS : REDEEM_STEPS
      const steps = decodeSteps(e.request_steps, labels)
      applyAttempts(steps.find((s) => s.step === 2), e.request_bridge_attempts)
      const legs = e.adapter_legs.map((l) => {
        const st = decodeSteps(l.steps, labels)
        applyAttempts(st.find((s) => s.step === 4), e.adapter_bridge_attempts.find((a) => a.chain_id === l.chain_id)?.attempts ?? [])
        return { chainId: Number(l.chain_id), steps: st }
      })
      out.push({
        requestId: e.request_id, kind, vault: e.info.vault.vault_address, vaultChainId: Number(e.info.vault.chain_id), amount: e.info.amount,
        status: e.status === 6 ? 'Completed' : 'Requested', settlementId: e.settlement_id, settled: e.settled,
        phase: e.status !== 6 ? 'processing' : e.settlement_id === 0n ? 'awaiting' : !e.settled ? 'settling' : 'receivable',
        steps, legs,
      })
    }
  }
  return out
}

export async function activeProgress(user: Address): Promise<Progress[]> {
  const all = await hubClient().readContract({ address: REG, abi: txRegistryAbi, functionName: 'get_investor_active_requests', args: [user] })
  return requestsProgress(all.filter((r) => r.product_id === pid).map((r) => r.request_id))
}

/** Activity list — active requests plus recent history. A pending request's settlement round is read from the ledger and joined in. */
export type ActivityItem = Progress & { round: number | null; settlement: SettlementProgress | null }
export async function activity(user: Address, recent = 20): Promise<ActivityItem[]> {
  const h = hubClient()
  const [active, [hist]] = await Promise.all([
    h.readContract({ address: REG, abi: txRegistryAbi, functionName: 'get_investor_active_requests', args: [user] }),
    h.readContract({ address: REG, abi: txRegistryAbi, functionName: 'get_investor_request_history', args: [user, pid, 0n, BigInt(recent)] }),
  ])
  const ids = [...new Set([...active.filter((r) => r.product_id === pid).map((r) => r.request_id), ...hist])]
  const progs = await requestsProgress(ids)
  const rounds = new Map<Hex, number>()
  await Promise.all(progs.map(async (p) => {
    if (p.settlementId !== 0n) { rounds.set(p.requestId, Number(p.settlementId)); return }
    const [, , , , sid] = await h.readContract({ address: INV, abi: investmentsAbi, functionName: 'get_request', args: [pid, p.requestId] }).catch(() => [0n, 0n, '0x', 0n, 0n, 0, 0] as const)
    rounds.set(p.requestId, Number(sid))
  }))
  const byRound = new Map<number, SettlementProgress>()
  await Promise.all([...new Set([...rounds.values()].filter((r) => r > 0))].map(async (r) => { byRound.set(r, await settlementProgress(r)) }))
  return progs.map((p) => {
    const r = rounds.get(p.requestId) ?? 0
    return { ...p, round: r || null, settlement: r ? byRound.get(r) ?? null : null }
  })
}

export type SettlementProgress = { round: number; status: 'Queued' | 'SettleStarted' | 'Settled'; started: TxStep; chains: { chainId: number; steps: TxStep[] }[] }
export async function settlementProgress(round: number): Promise<SettlementProgress> {
  const [startedTx, status, spokes, attempts] = await hubClient().readContract({ address: REG, abi: txRegistryAbi, functionName: 'get_settlement', args: [pid, BigInt(round)] })
  await loadBlockTimes([startedTx.recorded_at, ...spokes.flatMap((c) => stepBlocks(c.steps))])
  const chains = spokes.map((c, i) => {
    const steps = decodeSteps(c.steps, SETTLE_STEPS)
    const a = attempts[i]
    if (a) { applyAttempts(steps.find((s) => s.step === 2), a.collect_attempts); applyAttempts(steps.find((s) => s.step === 4), a.response_attempts); applyAttempts(steps.find((s) => s.step === 7), a.finalize_attempts) }
    return { chainId: Number(c.spoke_chain_id), steps }
  })
  return {
    round, status: status === 9 ? 'Settled' : status === 0 ? 'Queued' : 'SettleStarted',
    started: { step: 1, label: 'Settlement started', done: startedTx.recorded_at !== 0n, txHash: startedTx.recorded_at !== 0n ? startedTx.tx_hash : null, chainId: startedTx.recorded_at !== 0n ? Number(startedTx.chain_id) : null, at: blockTimes.get(startedTx.recorded_at) ?? null },
    chains,
  }
}

export type Receive = { txHash: Hex; chainId: number; vault: Address; kind: RequestKind; amount: bigint; at: Date | null }
export async function receiveHistory(user: Address, limit = 20): Promise<Receive[]> {
  const h = hubClient()
  const [entries] = await h.readContract({ address: REG, abi: txRegistryAbi, functionName: 'get_investor_receive_history', args: [user, pid, 0n, BigInt(limit)] })
  const rows = await Promise.all(entries.map(async (e) => {
    const [, amount, kind, tx] = await h.readContract({ address: REG, abi: txRegistryAbi, functionName: 'get_receive', args: [user, e.vault, e.tx_hash] })
    return { txHash: e.tx_hash, chainId: Number(e.vault.chain_id), vault: e.vault.vault_address, kind: (Number(kind) === 1 ? 'deposit' : 'redeem') as RequestKind, amount, recordedAt: tx.recorded_at }
  }))
  await loadBlockTimes(rows.map((r) => r.recordedAt))
  return rows.map(({ recordedAt, ...r }) => ({ ...r, at: blockTimes.get(recordedAt) ?? null }))
}

// -- yield sources --

export type YieldSource = { chainId: number; address: Address; name: string | null; principal: bigint; sharePct: number; positions: { asset: Address; amount: bigint; priceWad: bigint; usdValue: bigint }[] }
/** Per-source valuation for the latest round — from the ledger (get_adapter_valuations) plus each source's name. */
export async function yieldSources(): Promise<YieldSource[]> {
  const h = hubClient()
  const sid = await h.readContract({ address: INV, abi: investmentsAbi, functionName: 'get_settlement_id', args: [pid] })
  if (sid === 0n) return []
  const vals = await h.readContract({ address: INV, abi: investmentsAbi, functionName: 'get_adapter_valuations', args: [pid, sid] })
  const total = vals.reduce((a, v) => a + v.principal, 0n)
  return Promise.all(vals.map(async (v) => ({
    chainId: Number(v.chainId), address: v.adapter,
    name: await client(Number(v.chainId)).readContract({ address: v.adapter, abi: adapterNameAbi, functionName: 'name' }).catch(() => null),
    principal: v.principal, sharePct: total > 0n ? Number((v.principal * 10000n) / total) / 100 : 0,
    positions: v.positions.filter((p) => p.counted).map((p) => ({ asset: p.asset, amount: p.amount, priceWad: p.priceUsd, usdValue: p.usdValue })),
  })))
}

export type BasketHolding = { symbol: string; token: Address; amount: bigint; priceWad: bigint; weightBps: number }
/** Stock basket — the source's constituents and their current V3 pool price. */
export async function basketHoldings(): Promise<BasketHolding[]> {
  const { chainId, basketAdapter } = PRODUCT.robinhood
  const c = client(chainId)
  const n = Number(await c.readContract({ address: basketAdapter, abi: basketAdapterAbi, functionName: 'basketCount' }))
  return Promise.all(Array.from({ length: n }, async (_, i) => {
    const [token, pool, weightBps] = await c.readContract({ address: basketAdapter, abi: basketAdapterAbi, functionName: 'basket', args: [BigInt(i)] })
    const [symbol, amount, [sqrt], token0] = await Promise.all([
      c.readContract({ address: token, abi: erc20Abi, functionName: 'symbol' }),
      c.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [basketAdapter] }),
      c.readContract({ address: pool, abi: uniV3PoolAbi, functionName: 'slot0' }),
      c.readContract({ address: pool, abi: uniV3PoolAbi, functionName: 'token0' }),
    ])
    return { symbol, token, amount, priceWad: sqrtPriceToWad(sqrt, token0.toLowerCase() === token.toLowerCase()), weightBps }
  }))
}

export type LpStats = { reserveUsdc: bigint; reserveUsdt: bigint; lpShareBps: number; lpValue: bigint; totalAssets: bigint }
/** Stable pool — its reserves, and the source's LP share and its value. */
export async function lpStats(p: Product): Promise<LpStats> {
  const { chainId, lpAdapter, pool } = PRODUCT.sepolia
  const c = client(chainId)
  const usdc = p.tranches.find((t) => t.chainId === chainId)?.asset
  const [[r0, r1], supply, bal, lpValue, totalAssets, token0] = await Promise.all([
    c.readContract({ address: pool, abi: uniV2PoolAbi, functionName: 'getReserves' }),
    c.readContract({ address: pool, abi: uniV2PoolAbi, functionName: 'totalSupply' }),
    c.readContract({ address: pool, abi: uniV2PoolAbi, functionName: 'balanceOf', args: [lpAdapter] }),
    c.readContract({ address: lpAdapter, abi: lpAdapterAbi, functionName: 'lpValue' }),
    c.readContract({ address: lpAdapter, abi: lpAdapterAbi, functionName: 'totalAssets' }),
    c.readContract({ address: pool, abi: uniV3PoolAbi, functionName: 'token0' }),
  ])
  const usdcIs0 = !!usdc && token0.toLowerCase() === usdc.toLowerCase()
  return { reserveUsdc: usdcIs0 ? r0 : r1, reserveUsdt: usdcIs0 ? r1 : r0, lpShareBps: supply > 0n ? Number((bal * 10000n) / supply) : 0, lpValue, totalAssets }
}

export const hubChainId = hub.id
