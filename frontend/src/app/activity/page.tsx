'use client'
import { PageMotion } from '@/components/Motion'
import { DataSkeleton } from '@/components/Skeleton'
import { MotionLink as Link } from '@/components/MotionLink'
import { WalletEmpty, QueryNotice, PageHeading } from '@/components/State'
import { hubConfigured } from '@/lib/chains'
import { useWalletAccount } from '@/hooks/wallet'
import { useProduct, useActivity, useAccountData } from '@/hooks/data'
import { Steps } from '@/components/Steps'
import { chainLabel } from '@/lib/chains'
import { fmt, short } from '@/lib/math'

const PHASE: Record<string, [string, string]> = {
  processing: ['Processing', 'accent'],
  awaiting: ['Awaiting settlement', ''],
  settling: ['Settling', 'accent'],
  receivable: ['Settlement complete', 'ok']
}

/** Per-request cross-chain progress — steps, tx hashes and timestamps straight from the hub request registry. */
export default function ActivityPage() {
  return (
    <PageMotion>
      <div className="account-workspace">
        <ActivityContent />
      </div>
    </PageMotion>
  )
}
function ActivityContent() {
  const { address } = useWalletAccount()
  const product = useProduct()
  const p = product.data
  const act = useActivity(address)
  const account = useAccountData()
  const heading = (
    <PageHeading
      eyebrow="CROSS-CHAIN JOURNEY"
      title="Activity"
      description="Follow each request from submission to settlement and claim."
    />
  )
  if (!address)
    return (
      <>
        {heading}
        <WalletEmpty activity />
      </>
    )
  if (!hubConfigured)
    return (
      <>
        {heading}
        <QueryNotice title="Live activity is not connected yet">
          Your requests will appear when the settlement connection is ready.
        </QueryNotice>
      </>
    )
  if (product.isError || act.isError)
    return (
      <>
        {heading}
        <QueryNotice
          title="Unable to load activity"
          retry={() => {
            void product.refetch()
            void act.refetch()
          }}
        >
          Retry to retrieve your requests from the network.
        </QueryNotice>
      </>
    )
  if (!p || !act.data)
    return (
      <>
        {heading}
        <DataSkeleton label="Loading your requests" />
      </>
    )
  if (act.data.length === 0) {
    if (account.isPending)
      return (
        <>
          {heading}
          <DataSkeleton label="Checking vault requests" />
        </>
      )
    if (account.isError || account.data?.issues.positions.length)
      return (
        <>
          {heading}
          <QueryNotice
            title="Vault requests could not be checked"
            retry={() => void account.refetch()}
          >
            No Hub records are available yet. Retry to check for requests on the
            entry network before submitting another transaction.
          </QueryNotice>
        </>
      )
    const pending = account.data?.positions.some(
      (position) =>
        position.deposit.pending > 0n ||
        position.deposit.claimable > 0n ||
        position.redeem.pending > 0n ||
        position.redeem.claimable > 0n
    )
    return (
      <>
        {heading}
        <section className="empty-state card">
          <h2>
            {pending
              ? 'Your vault request is recorded.'
              : 'No Hub activity yet.'}
          </h2>
          <p>
            {pending
              ? 'Cross-chain records have not reached this activity feed yet. Check your position for pending amounts and available claims; do not submit the same request again.'
              : 'Requests appear here after they reach the settlement network. If you just submitted a transaction, allow time for the cross-chain records to arrive.'}
          </p>
          <Link
            className="btn primary"
            href={pending ? '/portfolio' : '/products/stocks-stable#invest'}
          >
            {pending ? 'View your position' : 'Explore the strategy'}
          </Link>
        </section>
      </>
    )
  }
  const dec = p.decimals
  return (
    <>
      {heading}
      <div className="request-list">
        {act.data.map((a) => {
          const t = p.tranches.find(
            (x) => x.vault.toLowerCase() === a.vault.toLowerCase()
          )
          const [label, cls] = PHASE[a.phase] ?? ['Pending', '']
          return (
            <details className="card request-row" key={a.requestId}>
              <summary className="request-summary">
                <div className="row">
                  <strong>
                    {a.kind === 'deposit' ? 'Deposit' : 'Redeem'}{' '}
                    {fmt(a.amount, dec)}{' '}
                    {a.kind === 'deposit' ? 'USDC' : 'shares'}
                  </strong>
                  {t && (
                    <span className={`pill ${t.type.toLowerCase()}`}>
                      {t.type}
                    </span>
                  )}
                  <span className="sub">{chainLabel(a.vaultChainId)}</span>
                </div>
                <div className="row">
                  <span className={`pill ${cls}`}>{label}</span>
                  {a.round && (
                    <span className="sub">settlement #{a.round}</span>
                  )}
                  <span className="mono muted">{short(a.requestId)}</span>
                </div>
              </summary>
              <div
                className="grid grid-2 request-detail"
                style={{ marginTop: 10 }}
              >
                <div>
                  <div className="sub">Request</div>
                  <Steps steps={a.steps} />
                </div>
                {a.legs.map((l) => (
                  <div key={l.chainId}>
                    <div className="sub">
                      Yield source · {chainLabel(l.chainId)}
                    </div>
                    <Steps steps={l.steps} />
                  </div>
                ))}
                {a.settlement && (
                  <div>
                    <div className="sub">
                      Settlement #{a.settlement.round} · {a.settlement.status}
                    </div>
                    <Steps steps={[a.settlement.started]} />
                    {a.settlement.chains.map((c) => (
                      <div key={c.chainId} style={{ marginTop: 6 }}>
                        <div className="sub">{chainLabel(c.chainId)}</div>
                        <Steps steps={c.steps} />
                      </div>
                    ))}
                  </div>
                )}
              </div>
              {a.phase === 'receivable' && (
                <div className="activity-next-action">
                  <p className="sub">
                    This request has settled. It may already have been claimed;
                    your current vault balance determines what is still
                    available.
                  </p>
                  <Link className="text-link" href="/portfolio">
                    View available claims →
                  </Link>
                </div>
              )}
            </details>
          )
        })}
      </div>
    </>
  )
}
