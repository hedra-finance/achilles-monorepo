'use client'
import type { Product, YieldSource } from '@/lib/reads'
import { useBasket, useLp } from '@/hooks/data'
import { fmt, pct, wadToNumber } from '@/lib/math'
import { PRODUCT } from '@/lib/product'
import { hubConfigured } from '@/lib/chains'

export function Allocation({
  product,
  sources,
  sourcesUnavailable
}: {
  product?: Product
  sources: YieldSource[]
  sourcesUnavailable: boolean
}) {
  const basket = useBasket()
  const lp = useLp()
  const dec = product?.decimals ?? 6
  const holdings = basket.data
  return (
    <div className="allocation-grid">
      <div className="card allocation-summary">
        <div>
          <h3>Two sources. One portfolio.</h3>
          <p>Target capital allocation across networks.</p>
        </div>
        <div className="allocation-target">
          <span className="source-badge">R</span>
          <div>
            <strong>Tokenized stocks</strong>
            <small>Robinhood Testnet</small>
          </div>
          <span>{PRODUCT.weights[PRODUCT.robinhood.chainId] / 100}%</span>
        </div>
        <div className="allocation-target">
          <span className="source-badge blue">◇</span>
          <div>
            <strong>Stablecoin LP</strong>
            <small>Ethereum Sepolia</small>
          </div>
          <span>{PRODUCT.weights[PRODUCT.sepolia.chainId] / 100}%</span>
        </div>
      </div>
      <div className="card source-card">
        <div className="source-heading">
          <span className="source-badge">R</span>
          <div>
            <h3>Technology stock basket</h3>
            <small>Robinhood Testnet</small>
          </div>
          <span className="pill">8 assets</span>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Asset</th>
                <th className="num">Target weight</th>
                <th className="num">Pool price</th>
              </tr>
            </thead>
            <tbody>
              {PRODUCT.robinhood.basket.map((b) => {
                const live = holdings?.find(
                  (h) => h.token.toLowerCase() === b.token.toLowerCase()
                )
                const weight = live?.weightBps ?? b.weightBps
                return (
                  <tr key={b.token}>
                    <td className="stock-name">
                      {b.symbol}
                      <small>{b.name}</small>
                    </td>
                    <td className="num">
                      {(weight / 100).toFixed(2)}%
                      <div className="mini-bar">
                        <i style={{ width: weight / 25 + '%' }} />
                      </div>
                    </td>
                    <td className="num">
                      {live ? '$' + wadToNumber(live.priceWad).toFixed(2) : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {basket.isError && (
          <p className="source-note">
            Live basket prices are unavailable.{' '}
            <button
              className="btn sm"
              disabled={basket.isFetching}
              onClick={() => {
                void basket.refetch()
              }}
            >
              Retry
            </button>
          </p>
        )}
        <p className="source-note">
          Testnet tokens representing a technology stock basket. Weights shown
          are configured targets, not guaranteed holdings.
        </p>
      </div>
      <div className="card source-card">
        <div className="source-heading">
          <span className="source-badge blue">◇</span>
          <div>
            <h3>USDC / USDT liquidity</h3>
            <small>Ethereum Sepolia</small>
          </div>
          <span className="pill">Stablecoin pair</span>
        </div>
        <div className="lp-visual" aria-hidden="true">
          <span className="token-disc">$</span>
          <span className="token-disc">₮</span>
        </div>
        <div className="lp-stats">
          <div>
            <small>LP position value</small>
            <strong>{fmt(lp.data?.lpValue, 6)}</strong>
            <small>USDC</small>
          </div>
          <div>
            <small>Share of the pool</small>
            <strong>{lp.data ? pct(lp.data.lpShareBps / 100) : '—'}</strong>
          </div>
          <div>
            <small>USDC reserves</small>
            <strong>{fmt(lp.data?.reserveUsdc, 6, 0)}</strong>
          </div>
          <div>
            <small>USDT reserves</small>
            <strong>{fmt(lp.data?.reserveUsdt, 6, 0)}</strong>
          </div>
        </div>
        {lp.isError && (
          <p className="source-note">
            Pool data is unavailable.{' '}
            <button
              className="btn sm"
              disabled={lp.isFetching}
              onClick={() => {
                void lp.refetch()
              }}
            >
              Retry
            </button>
          </p>
        )}
        <p className="source-note">
          A testnet constant-product pool with simulated trading volume. Swap
          fees accrue to the LP position; they are not a guaranteed return.
        </p>
        <div className="source-data">
          {sourcesUnavailable || !hubConfigured
            ? 'Live capital allocation is not available.'
            : sources.length === 0
              ? 'Capital allocation will appear after the first recorded settlement.'
              : sources.map((s) => (
                  <div key={s.chainId + s.address}>
                    {s.chainId === PRODUCT.robinhood.chainId
                      ? 'Stock basket'
                      : 'Stablecoin LP'}
                    : {fmt(s.principal, dec)} USDC · {pct(s.sharePct)} of
                    recorded principal
                  </div>
                ))}
        </div>
      </div>
    </div>
  )
}
