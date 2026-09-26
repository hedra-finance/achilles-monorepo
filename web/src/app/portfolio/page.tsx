'use client'
import { useAccount } from 'wagmi'
import { useProduct, useOverview, useAccountData, useReceives } from '@/hooks/data'
import { chainLabel, txUrl } from '@/lib/chains'
import { fmt, short } from '@/lib/math'

export default function PortfolioPage() {
  const { address } = useAccount()
  const { data: p } = useProduct()
  const ov = useOverview()
  const acct = useAccountData()
  const recv = useReceives(address)
  if (!address) return <div className="card sub">Connect a wallet to see your positions.</div>
  if (!p || !acct.data) return <div className="sub">Loading…</div>
  const last = ov.data?.last
  const dec = p.decimals
  const rows = p.tranches.map((t) => {
    const pos = acct.data!.positions.find((x) => x.index === t.index)!
    const price = last?.sharePrices[t.index] ?? 0n
    return { t, pos, value: price > 0n ? (pos.shares * price) / 10n ** 18n : null }
  })
  const total = rows.reduce((a, r) => a + (r.value ?? 0n), 0n)
  return (
    <>
      <div className="grid grid-3" style={{ marginBottom: 16 }}>
        <div className="card"><h3>Position value</h3><div className="kpi">{fmt(total, dec)} <span className="sub">USDC</span></div><div className="sub">at settlement #{last?.id ?? 0} prices</div></div>
        <div className="card"><h3>Wallet USDC</h3>{Object.entries(acct.data.balances).map(([c, b]) => <div key={c} className="row" style={{ justifyContent: 'space-between' }}><span className="sub">{chainLabel(Number(c))}</span><span>{fmt(b, dec)}</span></div>)}</div>
        <div className="card"><h3>Access</h3><span className={`pill ${acct.data.eligible ? 'ok' : 'bad'}`}>{acct.data.eligible ? 'Whitelisted' : 'Not whitelisted'}</span></div>
      </div>
      <div className="card" style={{ marginBottom: 16 }}>
        <h3>Positions</h3>
        <table>
          <thead><tr><th>Tranche</th><th>Network</th><th className="num">Shares</th><th className="num">Value (USDC)</th><th>Pending</th><th>Claimable</th></tr></thead>
          <tbody>{rows.map(({ t, pos, value }) => (
            <tr key={t.index}>
              <td><span className={`pill ${t.type.toLowerCase()}`}>{t.type}</span></td><td>{chainLabel(t.chainId)}</td>
              <td className="num">{fmt(pos.shares, dec, 4)}</td><td className="num">{fmt(value, dec)}</td>
              <td className="sub">{pos.deposit.pending > 0n && <>deposit {fmt(pos.deposit.pending, dec)}<br /></>}{pos.redeem.pending > 0n && <>redeem {fmt(pos.redeem.pending, dec)}</>}</td>
              <td className="sub">{pos.deposit.claimable > 0n && <>{fmt(pos.deposit.claimable, dec)} shares<br /></>}{pos.redeem.claimable > 0n && <>{fmt(pos.redeem.claimable, dec)} USDC</>}{pos.deposit.claimable === 0n && pos.redeem.claimable === 0n && '—'}</td>
            </tr>
          ))}</tbody>
        </table>
        <p className="sub" style={{ marginBottom: 0 }}>Claim from the Product page ticket (select the tranche and network).</p>
      </div>
      <div className="card">
        <h3>Received</h3>
        {!recv.data?.length ? <div className="sub">No claims yet.</div> : (
          <table><thead><tr><th>When</th><th>Kind</th><th>Network</th><th className="num">Amount</th><th>Tx</th></tr></thead>
            <tbody>{recv.data.map((r) => (
              <tr key={r.txHash}><td>{r.at?.toLocaleString() ?? '—'}</td><td>{r.kind === 'deposit' ? 'Shares' : 'USDC'}</td><td>{chainLabel(r.chainId)}</td><td className="num">{fmt(r.amount, dec, 4)}</td><td><a className="mono" href={txUrl(r.chainId, r.txHash) ?? '#'} target="_blank" rel="noreferrer">{short(r.txHash)}</a></td></tr>
            ))}</tbody></table>
        )}
      </div>
    </>
  )
}
