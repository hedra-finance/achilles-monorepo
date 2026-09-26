'use client'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { txUrl } from '@/lib/chains'
import { PRODUCT } from '@/lib/product'
import { short } from '@/lib/math'
import { Icon } from './Icon'
import { DataSkeleton } from './Skeleton'

type Event = {
  name: string
  contract: string
  at: string | null
  txHash: string | null
  block: number | null
}
type Category = 'All' | 'Investments' | 'Liquidity' | 'Access'
const EVENTS: Record<
  string,
  { label: string; category: Category; icon: 'wallet' | 'coins' | 'shield' }
> = {
  DepositRequest: {
    label: 'Deposit requested',
    category: 'Investments',
    icon: 'wallet'
  },
  RedeemRequest: {
    label: 'Redemption requested',
    category: 'Investments',
    icon: 'wallet'
  },
  Deposit: { label: 'Shares claimed', category: 'Investments', icon: 'wallet' },
  Withdraw: {
    label: 'Assets claimed',
    category: 'Investments',
    icon: 'wallet'
  },
  Supplied: {
    label: 'Liquidity supplied',
    category: 'Liquidity',
    icon: 'coins'
  },
  Withdrawn: {
    label: 'Liquidity withdrawn',
    category: 'Liquidity',
    icon: 'coins'
  },
  Claimed: {
    label: 'Human verification registered',
    category: 'Access',
    icon: 'shield'
  }
}

export function PoolActivity() {
  const [category, setCategory] = useState<Category>('All')
  const query = useQuery({
    queryKey: ['multibaas-events', PRODUCT.idHex, PRODUCT.sepolia.pool],
    queryFn: async (): Promise<Event[]> => {
      const response = await fetch('/api/multibaas?limit=25')
      const data = await response.json().catch(() => null)
      if (!response.ok || !Array.isArray(data?.events))
        throw new Error(
          data?.error ?? 'Indexed activity is temporarily unavailable.'
        )
      return data.events
    },
    refetchInterval: 30_000,
    retry: 0
  })
  const events = (query.data ?? []).filter(
    (event) =>
      category === 'All' ||
      EVENTS[event.name.split('(')[0]]?.category === category
  )
  return (
    <section
      id="pool-activity"
      className="card pool-activity"
      aria-labelledby="pool-activity-title"
    >
      <div className="desk-heading">
        <div>
          <span className="eyebrow">EXECUTION RECORDS / SEPOLIA</span>
          <h2 id="pool-activity-title">Activity behind the portfolio.</h2>
        </div>
        <button
          className="btn sm"
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
          aria-label="Refresh indexed activity"
        >
          <Icon name="refresh" size={14} />
          <span>{query.isFetching ? 'Refreshing…' : 'Refresh'}</span>
        </button>
      </div>
      <p className="market-disclosure">
        Product-wide requests, liquidity movements and verification records.
        Your personal request status is in Activity.
      </p>
      <div
        className="activity-filters"
        role="group"
        aria-label="Activity category"
      >
        {(['All', 'Investments', 'Liquidity', 'Access'] as const).map(
          (item) => (
            <button
              key={item}
              aria-pressed={category === item}
              className={category === item ? 'on' : ''}
              onClick={() => setCategory(item)}
            >
              {item}
            </button>
          )
        )}
      </div>
      {query.isError && (
        <div className="indexed-notice" role="status">
          <Icon name="info" size={17} />
          <p>
            {query.error.message} Direct chain data and your investment ticket
            remain available.
          </p>
        </div>
      )}
      {query.isPending ? (
        <DataSkeleton label="Loading indexed activity" rows={3} />
      ) : (
        query.data &&
        (events.length ? (
          <ol className="indexed-events">
            {events.map((event, i) => {
              const meaning = EVENTS[event.name.split('(')[0]]
              const href = event.txHash
                ? txUrl(PRODUCT.sepolia.chainId, event.txHash)
                : null
              return (
                <li key={`${event.txHash}-${event.name}-${i}`}>
                  <span className="indexed-event-icon">
                    <Icon name={meaning?.icon ?? 'activity'} size={17} />
                  </span>
                  <div className="indexed-event-copy">
                    <strong>{meaning?.label ?? event.name}</strong>
                    <span title={event.contract}>
                      {event.contract || 'Registered contract'}
                    </span>
                  </div>
                  <div className="indexed-event-meta">
                    {event.at ? (
                      <time dateTime={event.at}>
                        {new Date(event.at).toLocaleString([], {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit'
                        })}
                      </time>
                    ) : (
                      <span>
                        {event.block === null
                          ? 'Time unavailable'
                          : `Block ${event.block.toLocaleString()}`}
                      </span>
                    )}
                    {event.txHash &&
                      (href ? (
                        <a
                          href={href}
                          target="_blank"
                          rel="noreferrer"
                          className="mono"
                          aria-label={`View ${meaning?.label ?? event.name} transaction`}
                        >
                          {short(event.txHash)}{' '}
                          <Icon name="external" size={11} />
                        </a>
                      ) : (
                        <span className="mono">{short(event.txHash)}</span>
                      ))}
                  </div>
                </li>
              )
            })}
          </ol>
        ) : (
          <div className="indexed-empty">
            <Icon name="activity" size={24} />
            <strong>
              No {category === 'All' ? 'indexed' : category.toLowerCase()}{' '}
              events in this window.
            </strong>
            <p>
              The latest 25 indexed events appear here as activity is recorded.
            </p>
          </div>
        ))
      )}
      <footer className="indexed-footer">
        <span>Indexed by Curvegrid MultiBaas</span>
        <span>Indexing may lag on-chain confirmation.</span>
      </footer>
    </section>
  )
}
