'use client'
import { useQuery } from '@tanstack/react-query'
import { txUrl } from '@/lib/chains'
import { PRODUCT } from '@/lib/product'
import { short } from '@/lib/math'

type Ev = {
  name: string
  contract: string
  at: string | null
  txHash: string | null
  block: number | null
  fields: { name: string; value: string }[]
}

/** What each event means, so the panel reads as a story rather than a log dump. */
const MEANING: Record<string, string> = {
  DepositRequest: 'deposit requested',
  RedeemRequest: 'redeem requested',
  Deposit: 'shares claimed',
  Withdraw: 'assets claimed',
  Supplied: 'capital supplied to the Uniswap pool',
  Withdrawn: 'capital pulled back from the pool',
  Claimed: 'World ID verification recorded',
}

/**
 * Sepolia-side history, indexed by MultiBaas.
 *
 * The hub already tells us the cross-chain state of a request, but nothing on this side: who
 * supplied liquidity, when the trading bot's fees arrived, whether a verification actually landed
 * on chain. Those are events, and reading them over a public RPC means scanning logs on every load.
 */
export function PoolActivity() {
  const q = useQuery({
    queryKey: ['multibaas-events'],
    queryFn: async (): Promise<Ev[]> => {
      const r = await fetch('/api/multibaas?limit=25')
      // A failing route can answer with an empty or non-JSON body, and r.json() would then throw a
      // parser error that says nothing about what went wrong. Read the text and decide from it.
      const body = await r.text()
      let j: { events?: Ev[]; error?: string } = {}
      try { j = JSON.parse(body) } catch { /* left empty on purpose */ }
      if (!r.ok) throw new Error(j.error ?? `MultiBaas request failed (${r.status})`)
      return j.events ?? []
    },
    refetchInterval: 30_000,
    retry: 0,
  })

  if (q.isError) {
    return (
      <div className="card">
        <h3>On-chain activity (Sepolia)</h3>
        <span className="sub">{(q.error as Error).message}</span>
      </div>
    )
  }

  return (
    <div className="card">
      <h3>On-chain activity (Sepolia)</h3>
      {!q.data ? (
        <div className="sub">Loading…</div>
      ) : q.data.length === 0 ? (
        <div className="sub">No indexed events yet. They appear once the registered contracts see traffic.</div>
      ) : (
        <table>
          <thead>
            <tr><th>Event</th><th>Contract</th><th>When</th><th>Tx</th></tr>
          </thead>
          <tbody>
            {q.data.map((e, i) => (
              <tr key={`${e.txHash}-${i}`}>
                <td>
                  {e.name}
                  {MEANING[e.name] && <div className="sub">{MEANING[e.name]}</div>}
                </td>
                <td className="sub">{e.contract}</td>
                <td className="sub">{e.at ? new Date(e.at).toLocaleString() : e.block ?? '—'}</td>
                <td>
                  {e.txHash ? (
                    <a className="mono" href={txUrl(PRODUCT.sepolia.chainId, e.txHash) ?? '#'} target="_blank" rel="noreferrer">
                      {short(e.txHash)}
                    </a>
                  ) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="sub" style={{ marginBottom: 0 }}>Indexed by MultiBaas. Everything else on this page is read from the chains directly.</p>
    </div>
  )
}
