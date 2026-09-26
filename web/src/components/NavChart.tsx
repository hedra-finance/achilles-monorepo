import type { Settlement } from '@/lib/reads'

/** Share-price history line chart — a single inline SVG, no charting library. */
export function NavChart({ history, sr, jr }: { history: Settlement[]; sr: number; jr: number }) {
  const pts = history.filter((h) => h.at)
  if (pts.length < 2) return <div className="sub">Price history appears after the second settlement.</div>
  const W = 640, H = 180, P = 8
  const series = [
    { key: 'senior', color: 'var(--senior)', v: pts.map((h) => Number(h.sharePrices[sr] ?? 0n) / 1e18) },
    { key: 'junior', color: 'var(--junior)', v: pts.map((h) => Number(h.sharePrices[jr] ?? 0n) / 1e18) },
  ]
  const all = series.flatMap((s) => s.v).filter((v) => v > 0)
  const lo = Math.min(...all), hi = Math.max(...all), span = hi - lo || 1e-6
  const x = (i: number) => P + (i / (pts.length - 1)) * (W - 2 * P)
  const y = (v: number) => H - P - ((v - lo) / span) * (H - 2 * P)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label="Share price history">
      {[0.25, 0.5, 0.75].map((f) => <line key={f} x1={P} x2={W - P} y1={P + f * (H - 2 * P)} y2={P + f * (H - 2 * P)} stroke="var(--line)" />)}
      {series.map((s) => (
        <polyline key={s.key} fill="none" stroke={s.color} strokeWidth="2" points={s.v.map((v, i) => `${x(i)},${y(v || lo)}`).join(' ')} />
      ))}
      <text x={P} y={12} fontSize="11" fill="var(--muted)">{hi.toFixed(4)}</text>
      <text x={P} y={H - 2} fontSize="11" fill="var(--muted)">{lo.toFixed(4)}</text>
    </svg>
  )
}
