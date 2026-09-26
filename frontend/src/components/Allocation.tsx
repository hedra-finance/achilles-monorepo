'use client'
import { useEffect, useRef, useState } from 'react'
import type { Product, Settlement, YieldSource } from '@/lib/reads'
import { useBasket, useLp } from '@/hooks/data'
import {
  fmt,
  pct,
  holdingValueWad,
  priceChangePercent,
  short
} from '@/lib/math'
import { PRODUCT } from '@/lib/product'
import { addressUrl } from '@/lib/chains'
import { Icon } from './Icon'
import { HelpTip } from './HelpTip'
import { StockLogo } from './StockLogo'
import { DistributionChart } from './DistributionChart'
import { StockPricesChart } from './StockPricesChart'
import { DataSkeleton, LoadingValue } from './Skeleton'
import { stockDisplay } from '@/lib/stock-display'

export function Allocation({
  product,
  compact = false,
  sources,
  sourcesUnavailable,
  sourcesLoading = false,
  history
}: {
  product?: Product
  compact?: boolean
  sources: YieldSource[]
  sourcesUnavailable: boolean
  sourcesLoading?: boolean
  history: Settlement[]
}) {
  const basket = useBasket()
  const lp = useLp()
  const [view, setView] = useState<'allocation' | 'holdings' | 'prices'>(
    compact ? 'holdings' : 'allocation'
  )
  const [sourceTarget, setSourceTarget] = useState(false)
  const [holdingsTarget, setHoldingsTarget] = useState(false)
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
      className={`market-assets card ${compact ? 'compact-assets' : ''}`}
      aria-labelledby="assets-title"
    >
      <div className="desk-heading">
        <div>
          <span className="eyebrow">THE UNDERLYING STRATEGY</span>
          <h2 id="assets-title">Assets & prices</h2>
        </div>
        <button
          className={`btn sm ${basket.isFetching || lp.isFetching ? 'is-refreshing' : ''}`}
          aria-busy={basket.isFetching || lp.isFetching}
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
      <div className="asset-basket-heading">
        <div>
          <h3>
            {view === 'allocation' ? 'Source allocation' : 'Technology basket'}{' '}
            <span className="pill">
              {view === 'allocation' ? '2 sources' : `${rows.length} assets`}
            </span>
          </h3>
          <span>
            {view === 'allocation'
              ? 'Recorded principal across yield sources'
              : 'Robinhood Testnet · pool quotes in USDC'}
          </span>
        </div>
        <div>
          <small>
            {view === 'allocation'
              ? 'Recorded source principal'
              : 'Stock holdings value'}
          </small>
          <strong>
            {view === 'allocation'
              ? fmt(
                  sourcesUnavailable || !sources.length
                    ? null
                    : sources.reduce(
                        (sum, source) => sum + source.principal,
                        0n
                      ),
                  dec
                )
              : fmt(total, 18)}{' '}
            <small>USDC</small>
          </strong>
        </div>
      </div>
      <div className="market-toolbar">
        <div className="seg" role="group" aria-label="Asset view">
          <button
            aria-pressed={view === 'allocation'}
            className={view === 'allocation' ? 'on' : ''}
            onClick={() => setView('allocation')}
          >
            Allocation
          </button>
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
        {view !== 'allocation' && (
          <label className="asset-search">
            <span className="sr-only">Search assets</span>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search assets…"
              type="search"
            />
          </label>
        )}
      </div>
      <div key={view} className={`asset-view-content view-${view}`}>
        {view !== 'prices' && (
          <div className="distribution-controls">
            <span>
              {view === 'allocation'
                ? sourceTarget
                  ? 'Configured capital target'
                  : 'Latest recorded principal'
                : holdingsTarget
                  ? 'Configured stock targets'
                  : 'Current stock holdings'}
            </span>
            <div role="group" aria-label="Chart allocation basis">
              {[false, true].map((target) => (
                <button
                  key={String(target)}
                  aria-pressed={
                    (view === 'allocation' ? sourceTarget : holdingsTarget) ===
                    target
                  }
                  onClick={() =>
                    view === 'allocation'
                      ? setSourceTarget(target)
                      : setHoldingsTarget(target)
                  }
                >
                  {target ? 'Target' : 'Actual'}
                </button>
              ))}
            </div>
          </div>
        )}
        {view === 'allocation' && (
          <div className="asset-chart-panel">
            {sourcesLoading && !sourceTarget ? (
              <DataSkeleton
                kind="distribution"
                label="Loading source allocation"
              />
            ) : (
              <DistributionChart
                target={sourceTarget}
                decimals={dec}
                items={[
                  {
                    id: 'stocks',
                    label: 'Technology stock basket',
                    color: '#72c9fb',
                    chain: PRODUCT.robinhood.chainId
                  },
                  {
                    id: 'liquidity',
                    label: 'USDC / USDT liquidity',
                    color: '#4c80ed',
                    chain: PRODUCT.sepolia.chainId
                  }
                ].map((item) => {
                  const records = sources.filter(
                    (source) => source.chainId === item.chain
                  )
                  return {
                    ...item,
                    value: sourceTarget
                      ? BigInt(PRODUCT.weights[item.chain])
                      : sourcesUnavailable || !records.length
                        ? null
                        : records.reduce(
                            (sum, record) => sum + record.principal,
                            0n
                          )
                  }
                })}
              />
            )}
            <p className="market-disclosure">
              {sourceTarget
                ? 'Configured capital targets, not current holdings.'
                : 'Shares of recorded source principal at the latest finalized valuation. This total is not the same as strategy NAV or current market value.'}
            </p>
          </div>
        )}
        {view === 'holdings' && (
          <div className="asset-chart-panel">
            {basket.isPending && !holdingsTarget ? (
              <DataSkeleton
                kind="distribution"
                label="Loading stock holdings"
              />
            ) : (
              <DistributionChart
                kind="pie"
                target={holdingsTarget}
                decimals={18}
                emptyLabel="No stock positions yet"
                items={rows.map((r) => ({
                  id: r.token,
                  ticker: r.ticker,
                  label: r.ticker,
                  color: stockDisplay(r.ticker).color,
                  value: holdingsTarget ? BigInt(r.weightBps) : r.value
                }))}
              />
            )}
            <p className="market-disclosure">
              {holdingsTarget
                ? 'Configured stock weights. These are portfolio targets, not owned positions.'
                : 'Actual adapter holdings valued at current testnet pool prices. Cash and the LP position are excluded. Select Target to preview the intended basket.'}
            </p>
          </div>
        )}
        {view === 'prices' && <StockPricesChart history={history} />}
        {view !== 'allocation' && (
          <>
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
                  {filtered.map((r) => {
                    const change = priceChangePercent(
                      r.priceWad,
                      r.settled?.priceWad
                    )
                    const actual =
                      r.value != null && total != null && total > 0n
                        ? Number((r.value * 10_000n) / total) / 100
                        : null
                    return (
                      <tr
                        key={r.token}
                        className={
                          selectedToken === r.token ? 'asset-selected' : ''
                        }
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
                            <StockLogo ticker={r.ticker} />
                            <i
                              className="stock-color-key"
                              style={{
                                background: stockDisplay(r.ticker).color
                              }}
                            />
                            <span>
                              <strong>{r.ticker}</strong>
                              <small>{r.name}</small>
                            </span>
                          </button>
                        </td>
                        <td className="num market-price">
                          <LoadingValue loading={basket.isPending}>
                            {fmt(r.priceWad, 18, 2)}
                          </LoadingValue>
                        </td>
                        {view === 'holdings' ? (
                          <>
                            <td className="num">
                              {r.decimals == null
                                ? '—'
                                : fmt(r.amount, r.decimals, 4)}
                            </td>
                            <td className="num">
                              <LoadingValue loading={basket.isPending}>
                                {fmt(r.value, 18)}
                              </LoadingValue>
                            </td>
                            <td className="num">
                              <span>{pct(actual, 1)}</span>
                              <small>
                                {compact ? '/ ' : 'target '}
                                {pct(r.weightBps / 100, 1)}
                              </small>
                              <div className="weight-track">
                                <i style={{ width: `${r.weightBps / 100}%` }} />
                              </div>
                            </td>
                          </>
                        ) : (
                          <>
                            <td className="num">
                              {fmt(r.settled?.priceWad, 18, 2)}
                            </td>
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
                    Balances belong to the strategy adapter, not your wallet.
                    Values use the current testnet pool quote and exclude
                    uninvested cash.
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
          </>
        )}
      </div>
      {view !== 'allocation' && (
        <>
          <div className="market-freshness" role="status">
            <span
              className={
                'status-dot ' + (basket.isError || partial ? 'amber' : '')
              }
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
          <p className="market-disclosure compact-price-note">
            Testnet pool quotes · not exchange stock prices.{' '}
            <HelpTip label="About price data">
              Vs. settlement compares a current pool quote with the last
              recorded valuation, not a 24-hour return. Unavailable values stay
              blank.
            </HelpTip>
          </p>
          <p className="stock-logo-attribution">
            Company logos via{' '}
            <a
              href="https://www.tradingview.com/"
              target="_blank"
              rel="noreferrer"
            >
              TradingView
            </a>{' '}
            · price data from testnet pools and on-chain records.
          </p>
        </>
      )}
      <details className="liquidity-panel" open={compact ? undefined : true}>
        <summary>
          <span className="source-badge blue">◇</span>
          <span>
            <strong>USDC / USDT liquidity</strong>
            <small>Uniswap V2 · Ethereum Sepolia</small>
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
        <div className="pool-evidence-links">
          {[
            ['View liquidity pool', PRODUCT.sepolia.pool],
            ['View strategy adapter', PRODUCT.sepolia.lpAdapter]
          ].map(([label, address]) => {
            const href = addressUrl(PRODUCT.sepolia.chainId, address)
            return href ? (
              <a key={address} href={href} target="_blank" rel="noreferrer">
                {label} <Icon name="external" size={12} />
              </a>
            ) : null
          })}
          <span>
            {lp.dataUpdatedAt
              ? `Pool snapshot ${new Date(lp.dataUpdatedAt).toLocaleTimeString()} · refreshes every 30s`
              : 'Awaiting pool snapshot'}
          </span>
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
