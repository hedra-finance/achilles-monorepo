'use client'
import { useState } from 'react'
import type { Settlement } from '@/lib/reads'
import { fmt } from '@/lib/math'
import { DataSkeleton } from './Skeleton'
import { Icon } from './Icon'

const RANGES = [
  { label: '1D', ms: 86_400_000 },
  { label: '1W', ms: 604_800_000 },
  { label: '1M', ms: 2_592_000_000 },
  { label: 'All', ms: Infinity }
]
export function NavChart({
  history,
  sr,
  jr,
  loading = false,
  selected = 'Senior'
}: {
  loading?: boolean
  history: Settlement[]
  sr: number
  jr: number
  selected?: 'Senior' | 'Junior'
}) {
  const [range, setRange] = useState('All')
  const [compare, setCompare] = useState(false)
  const [activeId, setActiveId] = useState<number | null>(null)
  const sorted = history
    .filter((h) => h.at)
    .toSorted((a, b) => a.at!.getTime() - b.at!.getTime())
  const latestTime = sorted.at(-1)?.at?.getTime() ?? 0
  const windowMs = RANGES.find((r) => r.label === range)!.ms
  const pts = sorted.filter((h) => h.at!.getTime() >= latestTime - windowMs)
  const indices = [
    { index: sr, key: 'Senior', color: 'var(--senior)' },
    { index: jr, key: 'Junior', color: 'var(--junior)' }
  ].filter((s) => s.index >= 0 && (compare || s.key === selected))
  const values = indices
    .flatMap((s) =>
      pts.flatMap((h) =>
        h.sharePrices[s.index] == null
          ? []
          : [Number(h.sharePrices[s.index]) / 1e18]
      )
    )
    .filter(Number.isFinite)
  const active = pts.find((h) => h.id === activeId) ?? pts.at(-1)
  const W = 660,
    H = 235,
    L = 58,
    R = 18,
    T = 15,
    B = 28
  const min = values.length ? Math.min(...values) : 0,
    max = values.length ? Math.max(...values) : 1
  const pad = Math.max((max - min) * 0.15, max * 0.0005, 0.0001)
  const lo = Math.max(0, min - pad),
    hi = max + pad,
    span = hi - lo || 0.0001
  const first = pts[0]?.at?.getTime() ?? 0,
    duration = latestTime - first || 1
  const x = (h: Settlement) =>
    L + ((h.at!.getTime() - first) / duration) * (W - L - R)
  const y = (v: number) => H - B - ((v - lo) / span) * (H - T - B)
  const date = (d: Date) =>
    d.toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  const enough = pts.length >= 2 && values.length >= 2
  return (
    <div className="settlement-chart">
      <div className="chart-controls">
        <div role="group" aria-label="Chart range" className="chart-ranges">
          {RANGES.map((r) => (
            <button
              key={r.label}
              aria-pressed={range === r.label}
              className={range === r.label ? 'on' : ''}
              onClick={() => {
                setRange(r.label)
                setActiveId(null)
              }}
            >
              {r.label}
            </button>
          ))}
        </div>
        <button
          className="compare-toggle"
          aria-pressed={compare}
          onClick={() => setCompare(!compare)}
        >
          <span className={compare ? 'checked-box' : 'empty-box'}>
            {compare ? '✓' : ''}
          </span>
          Compare layers
        </button>
      </div>
      <div className="chart-readout" aria-live="polite">
        <div>
          <small>
            {active ? `Settlement #${active.id}` : 'Selected layer'}
          </small>
          <span>
            {active?.at ? date(active.at) : 'Awaiting finalized data'}
          </span>
        </div>
        <div>
          {(indices.length
            ? indices
            : [{ index: -1, key: selected, color: 'var(--senior)' }]
          ).map((s) => (
            <span key={s.key}>
              <i style={{ background: s.color }} />
              <small>{s.key}</small>
              <strong>{fmt(active?.sharePrices[s.index], 18, 6)}</strong>
            </span>
          ))}
        </div>
      </div>
      {loading ? (
        <DataSkeleton kind="chart" label="Loading finalized share prices" />
      ) : !enough ? (
        <div className="chart-empty">
          <span>
            <Icon name="chart" size={18} />
            No price history in this range yet.
          </span>
          <small>
            Two finalized settlements are needed. Try a wider range.
          </small>
        </div>
      ) : (
        <>
          <svg
            className="price-chart"
            viewBox={`0 0 ${W} ${H}`}
            role="img"
            aria-label={`${compare ? 'Senior and Junior' : selected} share prices in USDC, ${range} range`}
            onPointerMove={(e) => {
              const px =
                ((e.clientX - e.currentTarget.getBoundingClientRect().left) /
                  e.currentTarget.getBoundingClientRect().width) *
                W
              setActiveId(
                pts.reduce((closest, h) =>
                  Math.abs(x(h) - px) < Math.abs(x(closest) - px) ? h : closest
                ).id
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
                  {(hi - f * span).toFixed(4)}
                </text>
              </g>
            ))}
            {indices.map((s) => {
              let penDown = false
              const d = pts
                .map((h) => {
                  const raw = h.sharePrices[s.index]
                  if (raw == null) {
                    penDown = false
                    return ''
                  }
                  const point = `${penDown ? 'L' : 'M'}${x(h)},${y(Number(raw) / 1e18)}`
                  penDown = true
                  return point
                })
                .join(' ')
              return (
                <path
                  key={s.key}
                  d={d}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={s.key === selected ? 3 : 1.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <title>{s.key}</title>
                </path>
              )
            })}
            {active && (
              <line
                x1={x(active)}
                x2={x(active)}
                y1={T}
                y2={H - B}
                stroke="#8fa9c6"
                strokeDasharray="3 4"
              />
            )}
            <text x={L} y={H - 3} fontSize="10" fill="var(--muted)">
              {date(pts[0].at!)}
            </text>
            <text
              x={W - R}
              y={H - 3}
              fontSize="10"
              textAnchor="end"
              fill="var(--muted)"
            >
              {date(pts.at(-1)!.at!)}
            </text>
          </svg>
          <label className="chart-scrubber">
            <span>Inspect settlement</span>
            <input
              type="range"
              min={0}
              max={pts.length - 1}
              value={Math.max(
                0,
                pts.findIndex((h) => h.id === active?.id)
              )}
              onChange={(e) => setActiveId(pts[Number(e.target.value)].id)}
              aria-label="Inspect settlement price"
            />
          </label>
        </>
      )}
      <p className="market-disclosure">
        USDC per share · range ends at the latest recorded settlement. These are
        finalized share prices, not stock quotes.
      </p>
    </div>
  )
}
