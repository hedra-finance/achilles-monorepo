'use client'
import { useState } from 'react'
import { distribution, type WeightedItem } from '@/lib/chart-data'
import { fmt, pct } from '@/lib/math'
import { StockLogo } from './StockLogo'
import { ChainBadge, sourceChain } from './ChainBadge'

export function DistributionChart({
  items,
  kind = 'donut',
  decimals,
  target = false,
  emptyLabel = 'No allocation recorded'
}: {
  items: WeightedItem[]
  kind?: 'donut' | 'pie'
  decimals: number
  target?: boolean
  emptyLabel?: string
}) {
  const [focused, setFocused] = useState<string | null>(null)
  const result = distribution(items)
  const slices = result?.slices ?? []
  const active =
    slices.find((slice) => slice.id === focused) ??
    slices.toSorted((a, b) => b.percent - a.percent)[0]
  let cursor = -90
  const arcs = slices
    .filter((slice) => slice.percent > 0)
    .map((slice) => {
      const start = cursor
      cursor += slice.percent * 3.6
      const point = (degrees: number) => [
        130 + 105 * Math.cos((degrees * Math.PI) / 180),
        130 + 105 * Math.sin((degrees * Math.PI) / 180)
      ]
      const [x1, y1] = point(start),
        [x2, y2] = point(cursor)
      const d = `M130 130 L${x1} ${y1} A105 105 0 ${slice.percent > 50 ? 1 : 0} 1 ${x2} ${y2} Z`
      return { ...slice, start, d }
    })
  return (
    <div className={`distribution-layout ${kind}`}>
      <div className="distribution-visual">
        <svg
          viewBox="0 0 260 260"
          className="distribution-svg"
          role="img"
          aria-label={
            kind === 'pie'
              ? target
                ? 'Target stock weights'
                : 'Stock holdings by market value'
              : target
                ? 'Target source allocation'
                : 'Recorded source principal allocation'
          }
        >
          <circle
            cx="130"
            cy="130"
            r="105"
            fill={kind === 'pie' ? '#11243a' : 'none'}
            stroke="#1b3048"
            strokeWidth={kind === 'donut' ? 32 : 1}
          />
          {arcs.map((arc) => (
            <g
              key={arc.id}
              onPointerEnter={() => setFocused(arc.id)}
              onPointerLeave={() => setFocused(null)}
              opacity={focused && focused !== arc.id ? 0.45 : 1}
            >
              {kind === 'donut' ? (
                <circle
                  cx="130"
                  cy="130"
                  r="105"
                  fill="none"
                  stroke={arc.color}
                  strokeWidth={focused === arc.id ? 37 : 32}
                  strokeDasharray={`${(arc.percent / 100) * 2 * Math.PI * 105} ${2 * Math.PI * 105}`}
                  transform={`rotate(${arc.start} 130 130)`}
                />
              ) : arc.percent >= 99.999999 ? (
                <circle
                  cx="130"
                  cy="130"
                  r="105"
                  fill={arc.color}
                  stroke="#071423"
                  strokeWidth="2"
                />
              ) : (
                <path
                  d={arc.d}
                  fill={arc.color}
                  stroke="#071423"
                  strokeWidth="2"
                />
              )}
              <title>{`${arc.label}${arc.chainId ? ` · ${sourceChain(arc.chainId)?.name ?? arc.chainId}` : ''}: ${pct(arc.percent, 2)}`}</title>
            </g>
          ))}
          {kind === 'donut' && active && (
            <>
              <text
                x="130"
                y="125"
                textAnchor="middle"
                fill="#e4f2ff"
                fontSize="31"
                fontWeight="550"
              >
                {pct(active.percent, 1)}
              </text>
              <text
                x="130"
                y="149"
                textAnchor="middle"
                fill="#8aabc8"
                fontSize="9"
              >
                {focused ? 'SELECTED SOURCE' : 'LARGEST SOURCE'}
              </text>
            </>
          )}
          {!slices.length && (
            <>
              <text
                x="130"
                y="124"
                textAnchor="middle"
                fill="#aac4db"
                fontSize="24"
              >
                {result ? '0' : '—'}
              </text>
              <text
                x="130"
                y="146"
                textAnchor="middle"
                fill="#7d9cbb"
                fontSize="10"
              >
                {result ? 'NO POSITIONS YET' : 'DATA UNAVAILABLE'}
              </text>
            </>
          )}
        </svg>
        <span className="distribution-caption">
          {target
            ? 'Configured target weights'
            : result?.total
              ? `${fmt(result.total, decimals)} USDC`
              : result
                ? emptyLabel
                : 'Complete data needed to calculate weights'}
        </span>
      </div>
      <div className="distribution-legend" aria-label="Chart breakdown">
        {items.map((item) => {
          const slice = slices.find((s) => s.id === item.id)
          return (
            <button
              type="button"
              key={item.id}
              onMouseEnter={() => setFocused(item.id)}
              onMouseLeave={() => setFocused(null)}
              onFocus={() => setFocused(item.id)}
              onBlur={() => setFocused(null)}
              onClick={() => setFocused(focused === item.id ? null : item.id)}
              aria-pressed={focused === item.id}
              className={focused === item.id ? 'highlighted' : ''}
            >
              <i style={{ background: item.color }} />
              {item.ticker && <StockLogo ticker={item.ticker} />}
              <span>
                <strong>{item.label}</strong>
                {item.chainId && <ChainBadge chainId={item.chainId} />}
                {!target && <small>{fmt(item.value, decimals)} USDC</small>}
              </span>
              <b>{pct(slice?.percent, 1)}</b>
            </button>
          )
        })}
      </div>
    </div>
  )
}
