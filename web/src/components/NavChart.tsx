import type { Settlement } from '@/lib/reads'
import { Icon } from './Icon'

export function NavChart({
  history,
  sr,
  jr
}: {
  history: Settlement[]
  sr: number
  jr: number
}) {
  const pts = history
    .filter((h) => h.at)
    .sort((a, b) => a.at!.getTime() - b.at!.getTime())
  const indices = [
    { index: sr, key: 'Senior', color: 'var(--senior)' },
    { index: jr, key: 'Junior', color: 'var(--junior)' }
  ].filter((s) => s.index >= 0)
  const values = indices
    .flatMap((s) =>
      pts.flatMap((h) =>
        h.sharePrices[s.index] == null
          ? []
          : [Number(h.sharePrices[s.index]) / 1e18]
      )
    )
    .filter(Number.isFinite)
  if (pts.length < 2 || values.length < 2)
    return (
      <div className="chart-empty">
        <span>
          <Icon name="chart" size={18} />A clearer view, every settlement.
        </span>
        <small>Share price history appears after two settlements.</small>
      </div>
    )
  const W = 640,
    H = 220,
    L = 50,
    R = 12,
    T = 16,
    B = 28
  const min = Math.min(...values),
    max = Math.max(...values)
  const pad = Math.max((max - min) * 0.15, max * 0.0005, 0.0001)
  const lo = Math.max(0, min - pad),
    hi = max + pad,
    span = hi - lo || 0.0001
  const first = pts[0].at!.getTime(),
    duration = pts[pts.length - 1].at!.getTime() - first || 1
  const x = (h: Settlement) =>
    L + ((h.at!.getTime() - first) / duration) * (W - L - R)
  const y = (v: number) => H - B - ((v - lo) / span) * (H - T - B)
  const date = (d: Date) =>
    d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return (
    <svg
      className="price-chart"
      viewBox={'0 0 ' + W + ' ' + H}
      role="img"
      aria-label="Senior and Junior share prices by settlement time"
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
            x={0}
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
            const value = Number(raw) / 1e18
            const point = (penDown ? 'L' : 'M') + x(h) + ',' + y(value)
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
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <title>{s.key}</title>
          </path>
        )
      })}
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
        {date(pts[pts.length - 1].at!)}
      </text>
    </svg>
  )
}
