'use client'
import { useAccount } from 'wagmi'
import { useProduct, useActivity } from '@/hooks/data'
import { Steps } from '@/components/Steps'
import { chainLabel } from '@/lib/chains'
import { fmt, short } from '@/lib/math'

const PHASE: Record<string, [string, string]> = {
  processing: ['Processing', 'accent'], awaiting: ['Awaiting settlement', ''], settling: ['Settling', 'accent'], receivable: ['Ready to claim', 'ok'],
}

/** Per-request cross-chain progress — steps, tx hashes and timestamps straight from the hub request registry. */
export default function ActivityPage() {
  const { address } = useAccount()
  const { data: p } = useProduct()
  const act = useActivity(address)
  if (!address) return <div className="card sub">Connect a wallet to see your requests.</div>
  if (!p || !act.data) return <div className="sub">Loading…</div>
  if (act.data.length === 0) return <div className="card sub">No requests yet.</div>
  const dec = p.decimals
  return (
    <div className="grid">
      {act.data.map((a) => {
        const t = p.tranches.find((x) => x.vault.toLowerCase() === a.vault.toLowerCase())
        const [label, cls] = PHASE[a.phase]
        return (
          <div className="card" key={a.requestId}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <div className="row">
                <strong>{a.kind === 'deposit' ? 'Deposit' : 'Redeem'} {fmt(a.amount, dec)} {a.kind === 'deposit' ? 'USDC' : 'shares'}</strong>
                {t && <span className={`pill ${t.type.toLowerCase()}`}>{t.type}</span>}
                <span className="sub">{chainLabel(a.vaultChainId)}</span>
              </div>
              <div className="row"><span className={`pill ${cls}`}>{label}</span>{a.round && <span className="sub">settlement #{a.round}</span>}<span className="mono muted">{short(a.requestId)}</span></div>
            </div>
            <div className="grid grid-2" style={{ marginTop: 10 }}>
              <div><div className="sub">Request</div><Steps steps={a.steps} /></div>
              {a.legs.map((l) => <div key={l.chainId}><div className="sub">Yield source · {chainLabel(l.chainId)}</div><Steps steps={l.steps} /></div>)}
              {a.settlement && (
                <div>
                  <div className="sub">Settlement #{a.settlement.round} · {a.settlement.status}</div>
                  <Steps steps={[a.settlement.started]} />
                  {a.settlement.chains.map((c) => <div key={c.chainId} style={{ marginTop: 6 }}><div className="sub">{chainLabel(c.chainId)}</div><Steps steps={c.steps} /></div>)}
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
