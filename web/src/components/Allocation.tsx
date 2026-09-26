'use client'
import type { Product, YieldSource } from '@/lib/reads'
import { useBasket, useLp } from '@/hooks/data'
import { chainLabel } from '@/lib/chains'
import { fmt, pct, wadToNumber } from '@/lib/math'
import { PRODUCT } from '@/lib/product'

/** Where the capital sits — per-chain yield sources (from the ledger), the stock-basket composition, and the pool state. */
export function Allocation({ product, sources }: { product: Product; sources: YieldSource[] }) {
  const basket = useBasket()
  const lp = useLp()
  const dec = product.decimals
  const colors = ['var(--accent)', 'var(--senior)', 'var(--junior)']
  return (
    <div className="grid grid-2">
      <div className="card">
        <h3>Where the capital is</h3>
        {sources.length === 0 ? <div className="sub">Recorded at the first settlement.</div> : (
          <>
            <div className="bar" style={{ marginBottom: 10 }}>{sources.map((s, i) => <span key={s.address} style={{ width: `${s.sharePct}%`, background: colors[i % colors.length] }} />)}</div>
            <table><tbody>
              {sources.map((s, i) => (
                <tr key={s.address}>
                  <td><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: colors[i % colors.length], marginRight: 8 }} />{s.name ?? 'Yield source'}<div className="sub">{chainLabel(s.chainId)} · target {(PRODUCT.weights[s.chainId] ?? 0) / 100}%</div></td>
                  <td className="num">{fmt(s.principal, dec)} USDC<div className="sub">{pct(s.sharePct)}</div></td>
                </tr>
              ))}
            </tbody></table>
          </>
        )}
      </div>
      <div className="card">
        <h3>Robinhood · stock basket</h3>
        {!basket.data ? <div className="sub">Loading…</div> : basket.data.length === 0 ? <div className="sub">Basket not wired yet.</div> : (
          <table>
            <thead><tr><th>Stock</th><th className="num">Weight</th><th className="num">Price</th><th className="num">Held</th></tr></thead>
            <tbody>{basket.data.map((b) => (
              <tr key={b.token}><td>{b.symbol.replace(/^m/, '')}</td><td className="num">{(b.weightBps / 100).toFixed(2)}%</td><td className="num">${wadToNumber(b.priceWad).toFixed(2)}</td><td className="num">{fmt(b.amount, 6, 4)}</td></tr>
            ))}</tbody>
          </table>
        )}
      </div>
      <div className="card">
        <h3>Sepolia · USDC/USDT liquidity pool</h3>
        {!lp.data ? <div className="sub">Loading…</div> : (
          <div className="grid grid-3">
            <div><div className="sub">Pool reserves</div><div style={{ fontWeight: 600 }}>{fmt(lp.data.reserveUsdc, 6, 0)} USDC<br />{fmt(lp.data.reserveUsdt, 6, 0)} USDT</div></div>
            <div><div className="sub">Our share of the pool</div><div className="kpi" style={{ fontSize: 22 }}>{(lp.data.lpShareBps / 100).toFixed(2)}%</div></div>
            <div><div className="sub">LP position value</div><div className="kpi" style={{ fontSize: 22 }}>{fmt(lp.data.lpValue, 6)}</div><div className="sub">USDC, fair value 2·√(x·y)</div></div>
          </div>
        )}
        <p className="sub" style={{ marginBottom: 0 }}>A trading bot swaps against this pool around the clock; the 0.3% fee it pays accrues to the position. The same structure as Uniswap&apos;s USDC/USDT pool, with simulated volume.</p>
      </div>
    </div>
  )
}
