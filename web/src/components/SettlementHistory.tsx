'use client'
import { useState } from 'react'
import type { Settlement } from '@/lib/reads'
import { useSettlementProgress } from '@/hooks/data'
import { fmt } from '@/lib/math'
import { chainLabel } from '@/lib/chains'
import { Steps } from './Steps'
import { Icon } from './Icon'

export function SettlementHistory({
  history,
  sr,
  jr,
  decimals,
  unavailable
}: {
  history: Settlement[]
  sr: number
  jr: number
  decimals: number
  unavailable: boolean
}) {
  const [count, setCount] = useState(5)
  const [round, setRound] = useState<number | null>(null)
  const progress = useSettlementProgress(round)
  const sorted = history.toSorted((a, b) => b.id - a.id)
  function exportCsv() {
    const body = [
      'Round,Timestamp,Senior price (USDC),Junior price (USDC),Strategy NAV (USDC)',
      ...sorted.map((h) =>
        [
          h.id,
          h.at?.toISOString() ?? '',
          fmt(h.sharePrices[sr], 18, 8).replaceAll(',', ''),
          fmt(h.sharePrices[jr], 18, 8).replaceAll(',', ''),
          fmt(h.productNav, decimals, 6).replaceAll(',', '')
        ].join(',')
      )
    ].join('\n')
    const url = URL.createObjectURL(
      new Blob([body], { type: 'text/csv;charset=utf-8' })
    )
    const link = document.createElement('a')
    link.href = url
    link.download = 'achilles-settlements.csv'
    link.click()
    URL.revokeObjectURL(url)
  }
  return (
    <section
      className="card settlement-history"
      id="settlements"
      aria-labelledby="settlements-title"
    >
      <div className="desk-heading">
        <div>
          <span className="eyebrow">ON-CHAIN RECORD</span>
          <h2 id="settlements-title">Settlement history</h2>
        </div>
        <button
          className="btn sm"
          disabled={!sorted.length}
          onClick={exportCsv}
        >
          Export CSV
        </button>
      </div>
      {!sorted.length ? (
        <p className="table-empty">
          {unavailable
            ? 'Settlement history is unavailable. Retry the network connection above.'
            : 'No finalized settlements loaded yet.'}
        </p>
      ) : (
        <>
          <div
            className="table-scroll"
            tabIndex={0}
            role="region"
            aria-label="Settlement records"
          >
            <table>
              <thead>
                <tr>
                  <th>Round</th>
                  <th className="num">Senior price</th>
                  <th className="num">Junior price</th>
                  <th>Finalized at</th>
                </tr>
              </thead>
              <tbody>
                {sorted.slice(0, count).map((h) => (
                  <tr key={h.id}>
                    <td>
                      <button
                        className="round-button"
                        aria-expanded={round === h.id}
                        aria-controls="settlement-cycle"
                        onClick={() => setRound(round === h.id ? null : h.id)}
                      >
                        #{h.id}
                        <Icon name="chevron" size={12} />
                      </button>
                    </td>
                    <td className="num">{fmt(h.sharePrices[sr], 18, 6)}</td>
                    <td className="num">{fmt(h.sharePrices[jr], 18, 6)}</td>
                    <td>
                      {h.at?.toLocaleString([], {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                      }) ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {count < sorted.length && (
            <button
              className="text-link load-rounds"
              onClick={() => setCount(count + 10)}
            >
              Show more rounds ({sorted.length - count} remaining)
            </button>
          )}
          <p className="market-disclosure">
            Prices in USDC per share · showing {Math.min(count, sorted.length)}{' '}
            of {sorted.length} loaded rounds. Open a round to inspect its
            settlement cycle.
          </p>
        </>
      )}
      <div id="settlement-cycle">
        {round != null && (
          <div className="settlement-cycle">
            <div className="desk-heading">
              <h3>Settlement #{round}</h3>
              <button
                className="btn sm"
                onClick={() => setRound(null)}
                aria-label="Close settlement details"
              >
                <Icon name="close" size={14} />
              </button>
            </div>
            {progress.isError ? (
              <p className="err">
                Unable to load this cycle.{' '}
                <button
                  className="text-link"
                  onClick={() => void progress.refetch()}
                >
                  Retry
                </button>
              </p>
            ) : !progress.data ? (
              <p>Loading cycle…</p>
            ) : !progress.data.started.done &&
              progress.data.chains.length === 0 ? (
              <p className="market-disclosure">
                This round has finalized pricing, but no cycle trace was
                returned by the registry.
              </p>
            ) : (
              <>
                <span className="pill">{progress.data.status}</span>
                <Steps steps={[progress.data.started]} />
                {progress.data.chains.map((c) => (
                  <div key={c.chainId}>
                    <strong>{chainLabel(c.chainId)}</strong>
                    <Steps steps={c.steps} />
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </div>
    </section>
  )
}
