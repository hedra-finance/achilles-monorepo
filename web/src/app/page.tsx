'use client'
import { useProduct, useOverview } from '@/hooks/data'
import { NavChart } from '@/components/NavChart'
import { Ticket } from '@/components/Ticket'
import { Access } from '@/components/Access'
import { Allocation } from '@/components/Allocation'
import { fmt, pct, settlementAvgAprPercent, juniorYieldPercent, nextSettlement } from '@/lib/math'
import { chainLabel, hub } from '@/lib/chains'
import { PRODUCT } from '@/lib/product'

export default function ProductPage() {
  const product = useProduct()
  const ov = useOverview()
  const p = product.data
  if (product.isError) return <div className="card"><span className="err">Could not load the product. {(product.error as Error)?.message}</span></div>
  if (!p) return <div className="sub">Loading product from the hub…</div>
  const sr = Math.max(0, p.tranches.findIndex((t) => t.type === 'Senior'))
  const jr = p.tranches.findIndex((t) => t.type === 'Junior')
  const hist = ov.data?.history ?? []
  const series = (i: number) => hist.map((h) => ({ at: h.at, price: Number(h.sharePrices[i] ?? 0n) / 1e18 }))
  const srApr = p.tranches[sr] ? Number(p.tranches[sr].apr) / 1e16 : null
  const srReal = settlementAvgAprPercent(series(sr))
  const jrY = juniorYieldPercent(series(jr < 0 ? p.tranches.length - 1 : jr))
  const last = ov.data?.last ?? null
  const next = nextSettlement(p.settlement)
  const chains = [...new Set(p.tranches.map((t) => t.chainId))]
  return (
    <>
      <section className="hero">
        <h1>{PRODUCT.name}</h1>
        <p>Networks: {chains.map((c) => chainLabel(c)).join(', ')} — settled on {hub.name}.</p>
        <p>One product, two yield sources on two networks: a tokenized stock basket on Robinhood and a USDC/USDT liquidity position on Sepolia. You deposit USDC on Sepolia; capital is split {PRODUCT.weights[PRODUCT.robinhood.chainId] / 100}/{PRODUCT.weights[PRODUCT.sepolia.chainId] / 100} across the two networks, valued and settled every {p.settlement.length / 60} minutes. Senior takes a fixed rate first; Junior takes what is left.</p>
      </section>
      <div className="grid grid-3" style={{ margin: '16px 0' }}>
        <div className="card"><h3>Total value</h3><div className="kpi">{fmt(last?.productNav, p.decimals, 0)} <span className="sub">USDC</span></div><div className="sub">settlement #{last?.id ?? 0}{last?.at ? ` · ${last.at.toLocaleString()}` : ''}</div></div>
        <div className="card"><h3>Senior</h3><div className="kpi" style={{ color: 'var(--senior)' }}>{pct(srApr)}</div><div className="sub">fixed APR · realized {pct(srReal)} · price {last ? (Number(last.sharePrices[sr]) / 1e18).toFixed(4) : '—'}</div></div>
        <div className="card"><h3>Junior</h3><div className="kpi" style={{ color: 'var(--junior)' }}>{pct(jrY.percent)}</div><div className="sub">{jrY.annualized ? 'avg APR over settlements' : 'return since first settlement (less than a day of history)'} · price {last && jr >= 0 ? (Number(last.sharePrices[jr]) / 1e18).toFixed(4) : '—'}</div></div>
      </div>
      <div className="grid grid-2" style={{ gridTemplateColumns: '3fr 2fr', marginBottom: 16 }}>
        <div className="card">
          <h3>Share price</h3>
          <NavChart history={hist} sr={sr} jr={jr < 0 ? p.tranches.length - 1 : jr} />
          <div className="row sub" style={{ marginTop: 6 }}><span style={{ color: 'var(--senior)' }}>■ Senior</span><span style={{ color: 'var(--junior)' }}>■ Junior</span><span className="spacer" />Next settlement {next.cycleEnd.toLocaleTimeString()} · orders close {next.orderClose.toLocaleTimeString()}</div>
        </div>
        <div className="grid" style={{ alignContent: 'start' }}>
          <Ticket product={p} last={last} />
          <Access />
        </div>
      </div>
      <Allocation product={p} sources={ov.data?.sources ?? []} />
    </>
  )
}
