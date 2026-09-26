'use client'
import Link from 'next/link'
import { useAppKit } from '@reown/appkit/react'
import { Icon } from './Icon'

export function WalletEmpty({ activity = false }: { activity?: boolean }) {
  const { open } = useAppKit()
  return (
    <section className="empty-state card">
      <div className="empty-icon">
        <Icon name={activity ? 'activity' : 'wallet'} size={30} />
      </div>
      <span className="eyebrow">YOUR ACHILLES ACCOUNT</span>
      <h2>
        {activity ? 'Every step. In one place.' : 'Your position starts here.'}
      </h2>
      <p>
        {activity
          ? 'Follow your requests from deposit to settlement and claim, across every network.'
          : 'Connect your wallet to view your positions, pending requests, and available claims.'}
      </p>
      <button className="btn primary" onClick={() => open()}>
        Connect wallet <Icon name="arrow" size={17} />
      </button>
      <Link className="text-link" href="/products">
        Explore the strategy
      </Link>
      <div className="empty-foot">
        <Icon name="shield" size={15} /> Connecting a wallet does not initiate a
        transaction.
      </div>
    </section>
  )
}
export function QueryNotice({
  title,
  children,
  retry,
  busy = false
}: {
  title: string
  children?: React.ReactNode
  retry?: () => void
  busy?: boolean
}) {
  return (
    <div className="query-notice" role="status">
      <Icon name="info" size={18} />
      <div>
        <strong>{title}</strong>
        {children && <p>{children}</p>}
      </div>
      {retry && (
        <button className="btn sm" disabled={busy} onClick={retry}>
          <Icon name="refresh" size={14} />
          {busy ? 'Refreshing…' : 'Retry'}
        </button>
      )}
    </div>
  )
}
export function PageHeading({
  eyebrow,
  title,
  description
}: {
  eyebrow: string
  title: string
  description: string
}) {
  return (
    <div className="page-heading">
      <span className="eyebrow">{eyebrow}</span>
      <h1>{title}</h1>
      <p>{description}</p>
    </div>
  )
}
