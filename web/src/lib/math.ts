import { formatUnits } from 'viem'

const YEAR_MS = 31_557_600_000

/** Formats a token amount — truncates decimals, adds thousands separators. */
export function fmt(v: bigint | null | undefined, decimals: number, dp = 2): string {
  if (v == null) return '—'
  const s = formatUnits(v, decimals)
  const [i, f = ''] = s.split('.')
  const int = Number(i).toLocaleString('en-US')
  return dp === 0 ? int : `${int}.${(f + '0'.repeat(dp)).slice(0, dp)}`
}
export const pct = (v: number | null | undefined, dp = 2) => (v == null || !Number.isFinite(v) ? '—' : `${v.toFixed(dp)}%`)
export const wadToNumber = (v: bigint) => Number(v) / 1e18
export const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`

type Pt = { at: Date | null; price: number | null | undefined }
const valid = (s: Pt[]) => s.filter((p): p is { at: Date; price: number } => p.at !== null && p.price != null && p.price > 0)

/** Simple average of each settlement interval's annualized return. Stays sane even with a short history. */
export function settlementAvgAprPercent(series: Pt[]): number | null {
  const pts = valid(series)
  if (pts.length < 2) return null
  let sum = 0, n = 0
  for (let i = 1; i < pts.length; i++) {
    const dt = pts[i].at.getTime() - pts[i - 1].at.getTime()
    if (dt <= 0) continue
    sum += ((pts[i].price / pts[i - 1].price - 1) / dt) * YEAR_MS
    n++
  }
  return n === 0 ? null : (sum / n) * 100
}

/** Display yield for any tranche — left un-annualized (shown as the raw period return) until the history
 *  spans 24 hours. Annualizing a few hours turns a 0.6% entry cost into a four-digit percentage. */
export function displayYieldPercent(series: Pt[], minAnnualizeMs = 86_400_000): { percent: number | null; annualized: boolean } {
  const pts = valid(series)
  if (pts.length < 2) return { percent: null, annualized: false }
  const span = pts[pts.length - 1].at.getTime() - pts[0].at.getTime()
  if (span <= 0) return { percent: null, annualized: false }
  if (span >= minAnnualizeMs) return { percent: settlementAvgAprPercent(pts), annualized: true }
  return { percent: (pts[pts.length - 1].price / pts[0].price - 1) * 100, annualized: false }
}

/** Uniswap V3 sqrtPriceX96 → WAD price (USDC per token). Assumes both tokens use 6 decimals, matching the source contract. */
export function sqrtPriceToWad(sqrtPriceX96: bigint, tokenIsToken0: boolean): bigint {
  const rr = sqrtPriceX96 * sqrtPriceX96
  if (rr === 0n) return 0n
  return tokenIsToken0 ? ((rr >> 96n) * 10n ** 18n) >> 96n : (10n ** 18n << 192n) / rr
}

/** Next settlement time — derived from the ledger's (start, length, offset) schedule. */
export function nextSettlement(s: { start: number; length: number; offset: number }, now = Math.floor(Date.now() / 1000)) {
  const k = now <= s.start ? 0 : Math.ceil((now - s.start) / s.length)
  const cycleEnd = s.start + (k === 0 ? 1 : k) * s.length
  return { cycleEnd: new Date(cycleEnd * 1000), orderClose: new Date((cycleEnd - s.offset) * 1000) }
}
