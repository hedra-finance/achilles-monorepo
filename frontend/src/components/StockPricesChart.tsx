'use client'
import { useState } from 'react'
import type { Settlement } from '@/lib/reads'
import { useStockPriceHistory } from '@/hooks/data'
import { indexStockPrices } from '@/lib/chart-data'
import { fmt, pct } from '@/lib/math'
import { PRODUCT } from '@/lib/product'
import { stockDisplay } from '@/lib/stock-display'
import { StockLogo } from './StockLogo'
import { DataSkeleton } from './Skeleton'
import { Icon } from './Icon'

export function StockPricesChart({ history }: { history: Settlement[] }) {
  const query = useStockPriceHistory(history, true)
  const [hidden, setHidden] = useState<string[]>([])
  const [count, setCount] = useState(60)
  const [round, setRound] = useState<number | null>(null)
  const assets = PRODUCT.robinhood.basket.map((b) => ({
    token: b.token,
    ticker: b.symbol,
    color: stockDisplay(b.symbol).color
  }))
  const indexed = indexStockPrices(query.data?.points ?? [], assets)
  const offset = Math.max(0, indexed.points.length - count)
  const points = indexed.points.slice(offset)
  const series = indexed.series.map((s) => ({
    ...s,
    values: s.values.slice(offset)
  }))
  const visible = series.filter((s) => !hidden.includes(s.ticker))
  const activeIndex = Math.max(
    0,
    points.findIndex((p) => p.round === round)
  )
  const focus =
    round != null && points.some((p) => p.round === round)
      ? activeIndex
      : points.length - 1
  const active = points[focus]
  const values = visible.flatMap((s) =>
    s.values.filter((v): v is number => v != null)
  )
  const enough = visible.some(
    (s) => s.values.filter((v) => v != null).length >= 2
  )
  const W = 640,
    H = 240,
    L = 48,
    R = 15,
    T = 16,
    B = 25
  const min = values.length ? Math.min(...values) : 100,
    max = values.length ? Math.max(...values) : 100
  const pad = Math.max((max - min) * 0.15, 0.1),
    low = Math.max(0, min - pad),
    high = max + pad
  const span = high - low || 1
  const x = (i: number) =>
    L + (i / Math.max(1, points.length - 1)) * (W - L - R)
  const y = (v: number) => H - B - ((v - low) / span) * (H - T - B)
  return (
    <div className="stock-prices-chart">
      <div className="stock-chart-heading">
        <div>
          <strong>Stock price performance</strong>
          <small>Indexed settlement valuations</small>
        </div>
        <div
          className="chart-ranges"
          role="group"
          aria-label="Stock chart history range"
        >
          {[20, 60].map((n) => (
            <button
              key={n}
              aria-pressed={count === n}
              className={count === n ? 'on' : ''}
              onClick={() => {
                setCount(n)
                setRound(null)
              }}
            >
              Last {n}
            </button>
          ))}
        </div>
      </div>
      {query.isFetching && !query.data ? (
        <DataSkeleton kind="chart" label="Loading recorded stock prices" />
      ) : !enough ? (
        <div className="chart-empty">
          <Icon name="chart" size={22} />
          <span>
            {hidden.length === assets.length
              ? 'Select a stock to compare.'
              : 'Price history is building.'}
          </span>
          <small>
            Two recorded stock valuations are needed. Current pool quotes are
            available in the table below.
          </small>
        </div>
      ) : (
        <>
          <div className="stock-hover-readout">
            <strong>Settlement #{active?.round}</strong>
            <span>
              {active?.at?.toLocaleString([], {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
              }) ?? 'Time unavailable'}
            </span>
          </div>
          <svg
            className="stock-price-svg"
            viewBox={`0 0 ${W} ${H}`}
            role="img"
            aria-label="Stock prices indexed to a common recorded settlement"
            onPointerMove={(e) => {
              const bounds = e.currentTarget.getBoundingClientRect()
              const px = ((e.clientX - bounds.left) / bounds.width) * W
              setRound(
                points[
                  Math.max(
                    0,
                    Math.min(
                      points.length - 1,
                      Math.round(((px - L) / (W - L - R)) * (points.length - 1))
                    )
                  )
                ].round
              )
            }}
          >
            {[0, 0.25, 0.5, 0.75, 1].map((f) => (
              <g key={f}>
                <line
                  x1={L}
                  x2={W - R}
                  y1={T + f * (H - T - B)}
                  y2={T + f * (H - T - B)}
                  stroke="var(--line)"
                  strokeDasharray="3 5"
                />
                <text
                  x="0"
                  y={T + f * (H - T - B) + 4}
                  fontSize="10"
                  fill="var(--muted)"
                >
                  {(high - f * span).toFixed(1)}
                </text>
              </g>
            ))}
            {visible.map((s) => {
              let previous: number | null = null
              const d = s.values
                .map((v, i) => {
                  if (v == null) {
                    previous = null
                    return ''
                  }
                  const part =
                    previous == null ? `M${x(i)},${y(v)}` : `H${x(i)} V${y(v)}`
                  previous = v
                  return part
                })
                .join(' ')
              return (
                <g key={s.ticker}>
                  <path
                    d={d}
                    fill="none"
                    stroke={s.color}
                    strokeWidth="2"
                    strokeLinejoin="round"
                  >
                    <title>{s.ticker}</title>
                  </path>
                  {s.values[focus] != null && (
                    <circle
                      cx={x(focus)}
                      cy={y(s.values[focus]!)}
                      r="3.5"
                      fill={s.color}
                      stroke="#091524"
                    />
                  )}
                </g>
              )
            })}
            {focus >= 0 && (
              <line
                x1={x(focus)}
                x2={x(focus)}
                y1={T}
                y2={H - B}
                stroke="#748ba5"
                strokeDasharray="3 4"
              />
            )}
            <text x={L} y={H - 3} fontSize="10" fill="var(--muted)">
              #{points[0]?.round}
            </text>
            <text
              x={W - R}
              y={H - 3}
              fontSize="10"
              fill="var(--muted)"
              textAnchor="end"
            >
              #{points.at(-1)?.round}
            </text>
          </svg>
          <label className="chart-scrubber">
            <span>Inspect settlement</span>
            <input
              type="range"
              min={0}
              max={points.length - 1}
              value={focus}
              onChange={(e) => setRound(points[Number(e.target.value)].round)}
              aria-label="Inspect stock prices at settlement"
            />
          </label>
        </>
      )}
      <div
        className="stock-series-legend"
        aria-label="Stocks shown on the price chart"
      >
        {series.map((s) => {
          const value = s.values[focus],
            price = active?.prices[s.token.toLowerCase()]
          return (
            <button
              key={s.ticker}
              aria-pressed={!hidden.includes(s.ticker)}
              onClick={() =>
                setHidden(
                  hidden.includes(s.ticker)
                    ? hidden.filter((t) => t !== s.ticker)
                    : [...hidden, s.ticker]
                )
              }
              className={hidden.includes(s.ticker) ? 'series-hidden' : ''}
            >
              <StockLogo ticker={s.ticker} />
              <span>
                <strong>
                  <i style={{ background: s.color }} />
                  {s.ticker}
                </strong>
                <small>{fmt(price, 18, 2)} USDC</small>
              </span>
              <b
                className={
                  value != null && value < 100
                    ? 'negative'
                    : value != null && value > 100
                      ? 'positive'
                      : ''
                }
              >
                {value != null && value > 100 ? '+' : ''}
                {pct(value == null ? null : value - 100, 2)}
              </b>
            </button>
          )
        })}
      </div>
      <p className="market-disclosure">
        {indexed.baseline != null
          ? `Settlement #${indexed.baseline} = 100. `
          : ''}
        Up to 60 finalized rounds. Hover, tap or use the slider for prices.
        Missing records leave gaps; stocks without a positive baseline cannot be
        indexed. These are settlement records, not live quotes.
      </p>
      {(query.isError || !!query.data?.failures) && (
        <p className="err stock-chart-error">
          Some historical prices could not be loaded.{' '}
          <button
            className="text-link"
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            Retry history
          </button>
        </p>
      )}
    </div>
  )
}
