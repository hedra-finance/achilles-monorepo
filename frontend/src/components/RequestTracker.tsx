'use client'
import { MotionLink as Link } from '@/components/MotionLink'
import { Steps } from '@/components/Steps'
import { useWalletAccount } from '@/hooks/wallet'
import { useActivity } from '@/hooks/data'
import { chainLabel } from '@/lib/chains'
import { fmt, short } from '@/lib/math'

const PHASE: Record<string, [string, string]> = {
  processing: ['Processing', 'accent'],
  awaiting: ['Awaiting settlement', ''],
  settling: ['Settling', 'accent'],
  receivable: ['Ready to claim', 'ok']
}

/**
 * In-flight requests, shown directly under the trade panel.
 *
 * A deposit is not over when the button says it worked: it crosses to the hub,
 * waits for a settlement to price it, and only then can be claimed. Leaving that
 * on a separate page meant the one moment someone wants to see it — right after
 * submitting — is the moment they have navigated away from it. This shows the
 * same registry data as the activity page, trimmed to what is still moving.
 *
 * Renders nothing when there is nothing in flight, so the panel does not carry an
 * empty box for the ordinary case.
 */
export function RequestTracker({ decimals = 6 }: { decimals?: number }) {
  const { address } = useWalletAccount()
  const act = useActivity(address)
  if (!address) return null
  const live = (act.data ?? []).filter((a) => a.phase !== 'receivable' || !a.settled)
  if (!live.length) return null
  return (
    <section className="desk-trade-tracker" aria-label="Your requests in progress">
      <div className="row">
        <span className="sub">In progress</span>
        <Link href="/activity" className="sub">
          Full history
        </Link>
      </div>
      {live.slice(0, 3).map((a) => {
        const [label, cls] = PHASE[a.phase] ?? ['', '']
        return (
          <article key={a.requestId} className="desk-trade-tracker-item">
            <div className="row">
              <strong>
                {a.kind === 'deposit' ? 'Deposit' : 'Redeem'}{' '}
                {fmt(a.amount, decimals, 2)}{' '}
                {a.kind === 'deposit' ? 'USDC' : 'shares'}
              </strong>
              <span className={`pill ${cls}`}>{label}</span>
            </div>
            <Steps steps={a.steps} />
            {a.settlement && (
              <div className="sub">
                Settlement #{a.settlement.round} · {a.settlement.status}
              </div>
            )}
            <div className="row">
              <span className="sub">{chainLabel(a.vaultChainId)}</span>
              <span className="mono muted">{short(a.requestId)}</span>
            </div>
          </article>
        )
      })}
    </section>
  )
}
