'use client'
import { useState } from 'react'
import { juniorTestnetSeries as points } from '@/lib/junior-display'

/** Presentation-only series; never presented as finalized settlement prices. */
export function JuniorTestnetChart() {
  const [active, setActive] = useState(points.length - 1)
  const x = (i: number) => 58 + (i / (points.length - 1)) * 584
  const y = (v: number) => 207 - ((v - 23) / 0.8) * 192
  return (
    <div className="settlement-chart">
      <div className="chart-readout" aria-live="polite">
        <div>
          <small>Junior testnet APR</small>
          <span>Illustrative series · not recorded returns</span>
        </div>
        <div>
          <span>
            <i style={{ background: 'var(--junior)' }} />
            <small>Junior</small>
            <strong>{points[active].toFixed(2)}%</strong>
          </span>
        </div>
      </div>
      <svg
        className="price-chart"
        viewBox="0 0 660 235"
        role="img"
        aria-label="Illustrative Junior testnet APR around 23.4 percent"
        onPointerMove={(e) => {
          const bounds = e.currentTarget.getBoundingClientRect()
          const px = ((e.clientX - bounds.left) / bounds.width) * 660
          setActive(
            Math.max(
              0,
              Math.min(
                points.length - 1,
                Math.round(((px - 58) / 584) * (points.length - 1))
              )
            )
          )
        }}
      >
        {[23, 23.2, 23.4, 23.6, 23.8].map((v) => (
          <g key={v}>
            <line
              x1="58"
              x2="642"
              y1={y(v)}
              y2={y(v)}
              stroke="var(--line)"
              strokeDasharray="3 5"
            />
            <text x="0" y={y(v) + 4} fontSize="10" fill="var(--muted)">
              {v.toFixed(1)}%
            </text>
          </g>
        ))}
        <path
          d={points.map((v, i) => `${i ? 'L' : 'M'}${x(i)},${y(v)}`).join(' ')}
          fill="none"
          stroke="var(--junior)"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <line
          x1={x(active)}
          x2={x(active)}
          y1="15"
          y2="207"
          stroke="var(--muted)"
          strokeDasharray="3 4"
        />
        <circle
          cx={x(active)}
          cy={y(points[active])}
          r="4"
          fill="var(--junior)"
        />
      </svg>
      <label className="chart-scrubber">
        <span>Inspect APR</span>
        <input
          type="range"
          min="0"
          max={points.length - 1}
          value={active}
          onChange={(e) => setActive(Number(e.target.value))}
          aria-label="Inspect illustrative Junior APR"
        />
      </label>
      <p className="market-disclosure">
        Testnet illustration. Share prices, balances and settlement amounts use
        on-chain data.
      </p>
    </div>
  )
}
