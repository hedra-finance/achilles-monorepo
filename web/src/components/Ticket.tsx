'use client'
import { useMemo, useState } from 'react'
import { parseUnits } from 'viem'
import { useAccount, usePublicClient, useSwitchChain, useWalletClient } from 'wagmi'
import { useQueryClient } from '@tanstack/react-query'
import { useAppKit } from '@reown/appkit/react'
import type { Product, Settlement } from '@/lib/reads'
import { deposit, redeem, claim, toActionError } from '@/lib/writes'
import { chainLabel } from '@/lib/chains'
import { fmt } from '@/lib/math'
import { useAccountData } from '@/hooks/data'

type Mode = 'invest' | 'redeem'

/** Invest/redeem ticket — pick a tranche (Senior/Junior) and network, enter an amount, request against the spoke vault. */
export function Ticket({ product, last }: { product: Product; last: Settlement | null }) {
  const { address, chainId: walletChain } = useAccount()
  const { open } = useAppKit()
  const { switchChainAsync } = useSwitchChain()
  const { data: wallet } = useWalletClient()
  const qc = useQueryClient()
  const acct = useAccountData()
  const [mode, setMode] = useState<Mode>('invest')
  const [type, setType] = useState<'Senior' | 'Junior'>('Senior')
  const [chain, setChain] = useState<number>(product.depositChains[0] ?? product.tranches[0]?.chainId)
  const [amt, setAmt] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok?: string; err?: string } | null>(null)
  const pub = usePublicClient({ chainId: chain })

  const tranche = useMemo(() => product.tranches.find((t) => t.type === type && t.chainId === chain), [product, type, chain])
  const pos = acct.data?.positions.find((p) => p.index === tranche?.index)
  const price = last && tranche ? last.sharePrices[tranche.index] : null
  const dec = product.decimals
  const raw = (() => { try { return amt ? parseUnits(amt, dec) : 0n } catch { return 0n } })()
  const est = price && price > 0n ? (mode === 'invest' ? (raw * 10n ** 18n) / price : (raw * price) / 10n ** 18n) : null
  const balance = mode === 'invest' ? acct.data?.balances[chain] : pos?.shares
  const eligible = acct.data?.eligible

  async function run(fn: () => Promise<`0x${string}`>, label: string) {
    setBusy(true); setMsg(null)
    try {
      if (walletChain !== chain) await switchChainAsync({ chainId: chain })
      const hash = await fn()
      setMsg({ ok: `${label} submitted · ${hash.slice(0, 10)}…` })
      setAmt('')
      qc.invalidateQueries({ queryKey: ['account'] }); qc.invalidateQueries({ queryKey: ['activity'] })
    } catch (e) { setMsg({ err: toActionError(e).message }) } finally { setBusy(false) }
  }
  const ctx = () => ({ wallet: wallet!, pub: pub!, me: address! })

  if (!tranche) return null
  return (
    <div className="card">
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
        <div className="seg">
          <button className={mode === 'invest' ? 'on' : ''} onClick={() => setMode('invest')}>Invest</button>
          <button className={mode === 'redeem' ? 'on' : ''} onClick={() => setMode('redeem')}>Redeem</button>
        </div>
        <div className="seg">
          <button className={type === 'Senior' ? 'on' : ''} onClick={() => setType('Senior')}>Senior</button>
          <button className={type === 'Junior' ? 'on' : ''} onClick={() => setType('Junior')}>Junior</button>
        </div>
      </div>
      <label className="sub">Network</label>
      <div className="row" style={{ marginBottom: 10 }}>
        <select value={chain} onChange={(e) => setChain(Number(e.target.value))}>
          {product.depositChains.map((c) => <option key={c} value={c}>{chainLabel(c)}</option>)}
        </select>
        {address && <span className="sub">{mode === 'invest' ? 'USDC' : 'shares'} on this network: {fmt(balance, dec)}</span>}
      </div>
      <input className="amt" inputMode="decimal" placeholder="0.00" value={amt} onChange={(e) => setAmt(e.target.value.replace(/[^0-9.]/g, ''))} />
      <div className="row" style={{ justifyContent: 'space-between', margin: '8px 0 12px' }}>
        <span className="sub">{mode === 'invest' ? 'Est. shares' : 'Est. USDC'}: {est != null ? fmt(est, dec, 4) : '—'} <span className="muted">(at last settlement price)</span></span>
        {balance != null && <button className="btn sm" onClick={() => setAmt(fmt(balance, dec, dec).replace(/,/g, ''))}>Max</button>}
      </div>
      {!address ? <button className="btn primary" style={{ width: '100%' }} onClick={() => open()}>Connect wallet</button>
        : eligible === false && mode === 'invest' ? <button className="btn" style={{ width: '100%' }} disabled>Not whitelisted yet — see Access below</button>
        : <button className="btn primary" style={{ width: '100%' }} disabled={busy || raw === 0n || !wallet}
            onClick={() => run(() => (mode === 'invest' ? deposit(ctx(), tranche, raw) : redeem(ctx(), tranche, raw)), mode === 'invest' ? 'Deposit request' : 'Redeem request')}>
            {busy ? 'Confirm in wallet…' : mode === 'invest' ? 'Request deposit' : 'Request redeem'}
          </button>}
      {pos && (pos.deposit.claimable > 0n || pos.redeem.claimable > 0n) && (
        <div className="row" style={{ marginTop: 10 }}>
          {pos.deposit.claimable > 0n && <button className="btn sm" disabled={busy} onClick={() => run(() => claim(ctx(), tranche, 'deposit'), 'Claim shares')}>Claim {fmt(pos.deposit.claimable, dec)} shares</button>}
          {pos.redeem.claimable > 0n && <button className="btn sm" disabled={busy} onClick={() => run(() => claim(ctx(), tranche, 'redeem'), 'Claim USDC')}>Claim {fmt(pos.redeem.claimable, dec)} USDC</button>}
        </div>
      )}
      {pos && (pos.deposit.pending > 0n || pos.redeem.pending > 0n) && (
        <p className="sub" style={{ marginBottom: 0 }}>
          {pos.deposit.pending > 0n && <>Deposit of {fmt(pos.deposit.pending, dec)} USDC is {STAGE[pos.deposit.stage ?? 'queued']}. </>}
          {pos.redeem.pending > 0n && <>Redeem of {fmt(pos.redeem.pending, dec)} shares is {STAGE[pos.redeem.stage ?? 'queued']}.</>}
        </p>
      )}
      {msg?.ok && <p className="okmsg">{msg.ok}</p>}
      {msg?.err && <p className="err">{msg.err}</p>}
    </div>
  )
}
const STAGE: Record<string, string> = { bridging: 'bridging to the hub', queued: 'waiting for the next settlement', settlement: 'being finalized after settlement', receivable: 'ready to claim' }
