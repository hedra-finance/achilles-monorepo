'use client'
import { useEffect, useRef, useState } from 'react'
import type { Product, YieldSource } from '@/lib/reads'
import { useBasket, useLp } from '@/hooks/data'
import {
  fmt,
  pct,
  holdingValueWad,
  priceChangePercent,
  short
} from '@/lib/math'
import { PRODUCT } from '@/lib/product'
import { Icon } from './Icon'

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
  const [view, setView] = useState<'holdings' | 'prices'>('holdings')
  const [selectedToken, setSelectedToken] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const detail = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (selectedToken)
      detail.current?.scrollIntoView({ block: 'nearest', behavior: 'instant' })
  }, [selectedToken])
  const dec = product?.decimals ?? 6
  const settledStocks = sources.find(
    (s) => s.chainId === PRODUCT.robinhood.chainId
  )
  const rows = (
    basket.data ??
    PRODUCT.robinhood.basket.map((b) => ({
      ...b,
      pool: b.pool ?? '',
      amount: null,
      decimals: null,
      priceWad: null,
      block: null
    }))
  ).map((h) => {
    const config = PRODUCT.robinhood.basket.find(
      (b) => b.token.toLowerCase() === h.token.toLowerCase()
    )
    const settled = !sourcesUnavailable
      ? settledStocks?.positions.find(
          (p) => p.asset.toLowerCase() === h.token.toLowerCase()
        )
      : undefined
    return {
      ...h,
      name: config?.name ?? h.symbol,
      ticker: config?.symbol ?? h.symbol,
      value: holdingValueWad(h.amount, h.priceWad, h.decimals),
      settled
    }
  })
  const complete = !!basket.data && rows.every((r) => r.value != null)
  const total = complete ? rows.reduce((v, r) => v + r.value!, 0n) : null
  const filtered = rows.filter((r) =>
    `${r.ticker} ${r.name}`.toLowerCase().includes(search.toLowerCase())
  )
  const selected = rows.find((r) => r.token === selectedToken)
  const updated = basket.dataUpdatedAt
    ? new Date(basket.dataUpdatedAt).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      })
    : null
  const partial = basket.data?.some(
    (r) => r.amount == null || r.priceWad == null || r.decimals == null
  )
  return (
    <section
      id="strategy"
      className="market-assets card"
      aria-labelledby="assets-title"
    >
      <div className="desk-heading">
        <div>
          <span className="eyebrow">THE UNDERLYING STRATEGY</span>
          <h2 id="assets-title">Assets & prices</h2>
        </div>
        <button
          className="btn sm"
          disabled={basket.isFetching || lp.isFetching}
          onClick={() => {
            void basket.refetch()
            void lp.refetch()
          }}
          aria-label="Refresh asset prices"
        >
          <Icon name="refresh" size={14} /> Refresh
        </button>
      </div>
      <div className="capital-split" aria-label="Target capital allocation">
        <div>
          <span>
            <i className="legend-dot senior" /> Stock basket
          </span>
          <strong>{PRODUCT.weights[PRODUCT.robinhood.chainId] / 100}%</strong>
        </div>
        <div>
          <span>
            <i className="legend-dot junior" /> Stablecoin LP
          </span>
          <strong>{PRODUCT.weights[PRODUCT.sepolia.chainId] / 100}%</strong>
        </div>
        <div className="split-track">
          <i
            style={{
              width: `${PRODUCT.weights[PRODUCT.robinhood.chainId] / 100}%`
            }}
          />
        </div>
        <small>Target allocation · actual positions can differ</small>
      </div>
      <div className="asset-basket-heading">
        <div>
          <h3>
            Technology basket <span className="pill">{rows.length} assets</span>
          </h3>
          <span>Robinhood Testnet · pool quotes in USDC</span>
        </div>
        <div>
          <small>Stock holdings value</small>
          <strong>
            {fmt(total, 18)} <small>USDC</small>
          </strong>
        </div>
      </div>
      <div className="market-toolbar">
        <div className="seg" role="group" aria-label="Asset view">
          <button
            aria-pressed={view === 'holdings'}
            className={view === 'holdings' ? 'on' : ''}
            onClick={() => setView('holdings')}
          >
            Holdings
          </button>
          <button
            aria-pressed={view === 'prices'}
            className={view === 'prices' ? 'on' : ''}
            onClick={() => setView('prices')}
          >
            Prices
          </button>
        </div>
        <label className="asset-search">
          <span className="sr-only">Search assets</span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search assets…"
            type="search"
          />
        </label>
      </div>
      <div
        className="table-scroll market-table-wrap"
        tabIndex={0}
        role="region"
        aria-label="Stock prices and holdings"
      >
        <table className="market-table">
          <thead>
            <tr>
              <th>Asset</th>
              <th className="num">
                Pool price <small>USDC / token</small>
              </th>
              {view === 'holdings' ? (
                <>
                  <th className="num">Held tokens</th>
                  <th className="num">
                    Value <small>USDC</small>
                  </th>
                  <th className="num">
                    Actual / target <small>within basket</small>
                  </th>
                </>
              ) : (
                <>
                  <th className="num">
                    Settled price <small>USDC / token</small>
                  </th>
                  <th className="num">Vs. settlement</th>
                  <th className="num">Target weight</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {filtered.map((r, i) => {
              const change = priceChangePercent(r.priceWad, r.settled?.priceWad)
              const actual =
                r.value != null && total != null && total > 0n
                  ? Number((r.value * 10_000n) / total) / 100
                  : null
              return (
                <tr
                  key={r.token}
                  className={selectedToken === r.token ? 'asset-selected' : ''}
                >
                  <td>
                    <button
                      className="asset-open"
                      aria-expanded={selectedToken === r.token}
                      aria-controls="asset-detail"
                      onClick={() =>
                        setSelectedToken(
                          selectedToken === r.token ? null : r.token
                        )
                      }
                    >
                      <span className={`asset-monogram tone-${i % 4}`}>
                        {r.ticker.slice(0, 1)}
                      </span>
                      <span>
                        <strong>{r.ticker}</strong>
                        <small>{r.name}</small>
                      </span>
                    </button>
                  </td>
                  <td className="num market-price">{fmt(r.priceWad, 18, 2)}</td>
                  {view === 'holdings' ? (
                    <>
                      <td className="num">
                        {r.decimals == null
                          ? '—'
                          : fmt(r.amount, r.decimals, 4)}
                      </td>
                      <td className="num">{fmt(r.value, 18)}</td>
                      <td className="num">
                        <span>{pct(actual, 1)}</span>
                        <small>target {pct(r.weightBps / 100, 1)}</small>
                        <div className="weight-track">
                          <i style={{ width: `${r.weightBps / 100}%` }} />
                        </div>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="num">{fmt(r.settled?.priceWad, 18, 2)}</td>
                      <td
                        className={`num ${change == null ? '' : change >= 0 ? 'positive' : 'negative'}`}
                      >
                        {change != null && change > 0 ? '+' : ''}
                        {pct(change)}
                      </td>
                      <td className="num">{pct(r.weightBps / 100, 2)}</td>
                    </>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
        {!filtered.length && (
          <p className="table-empty">No assets match “{search}”.</p>
        )}
      </div>
      <p className="mobile-table-hint">
        Swipe the table for more details <Icon name="arrow" size={11} />
      </p>
      <div id="asset-detail" ref={detail}>
        {selected && (
          <div className="asset-detail">
            <div>
              <span className="eyebrow">TOKEN DETAILS</span>
              <strong>{selected.name}</strong>
            </div>
            <dl>
              <div>
                <dt>Token</dt>
                <dd className="mono" title={selected.token}>
                  {short(selected.token)}
                </dd>
              </div>
              <div>
                <dt>Pool</dt>
                <dd className="mono" title={selected.pool}>
                  {selected.pool ? short(selected.pool) : '—'}
                </dd>
              </div>
              <div>
                <dt>Snapshot block</dt>
                <dd>{selected.block?.toString() ?? '—'}</dd>
              </div>
              <div>
                <dt>Decimals</dt>
                <dd>{selected.decimals ?? '—'}</dd>
              </div>
            </dl>
            <p>
              Balances belong to the strategy adapter, not your wallet. Values
              use the current testnet pool quote and exclude uninvested cash.
            </p>
            <button
              className="text-link"
              onClick={() => setSelectedToken(null)}
            >
              Close details
            </button>
          </div>
        )}
      </div>
      <div className="market-freshness" role="status">
        <span
          className={'status-dot ' + (basket.isError || partial ? 'amber' : '')}
        />
        <span>
          {basket.isError
            ? basket.data
              ? 'Refresh failed · showing the last fetched snapshot'
              : 'Stock data unavailable · retry to fetch prices'
            : partial
              ? 'Some values unavailable · available values remain visible'
              : basket.isPending
                ? 'Reading stock pools…'
                : `Snapshot ${updated} · refreshes every 60s`}
        </span>
      </div>
      <p className="market-disclosure">
        Pool prices are testnet quotes, not exchange stock prices. “Vs.
        settlement” compares a current pool quote with the last available
        recorded valuation; it is not a 24-hour return. Unavailable data stays
        blank.
      </p>
      <details className="liquidity-panel" open>
        <summary>
          <span className="source-badge blue">◇</span>
          <span>
            <strong>USDC / USDT liquidity</strong>
            <small>Ethereum Sepolia · stablecoin pool</small>
          </span>
          <span className="liquidity-value">
            {fmt(lp.data?.lpValue, 6)} <small>USDC</small>
          </span>
          <Icon name="chevron" size={14} />
        </summary>
        <div className="liquidity-metrics">
          <div>
            <small>USDC reserves</small>
            <strong>{fmt(lp.data?.reserveUsdc, 6)}</strong>
          </div>
          <div>
            <small>USDT reserves</small>
            <strong>{fmt(lp.data?.reserveUsdt, 6)}</strong>
          </div>
          <div>
            <small>Strategy share of pool</small>
            <strong>{pct(lp.data ? lp.data.lpShareBps / 100 : null)}</strong>
          </div>
          <div>
            <small>Total adapter assets</small>
            <strong>
              {fmt(lp.data?.totalAssets, 6)} <small>USDC</small>
            </strong>
          </div>
        </div>
        <p className="market-disclosure">
          {lp.isError ? 'Pool refresh failed. ' : ''}Testnet pool with simulated
          trading volume. Trading fees accrue to LPs; returns are not
          guaranteed.
        </p>
      </details>
      <div className="recorded-allocation">
        <span>Recorded principal allocation</span>
        {sourcesUnavailable ? (
          <small>Settlement data unavailable</small>
        ) : sources.length ? (
          sources.map((s) => (
            <small key={s.address}>
              {s.chainId === PRODUCT.robinhood.chainId ? 'Stocks' : 'LP'}{' '}
              {fmt(s.principal, dec)} USDC · {pct(s.sharePct, 1)}
            </small>
          ))
        ) : (
          <small>Awaiting a recorded valuation</small>
        )}
      </div>
    </section>
  )
}
