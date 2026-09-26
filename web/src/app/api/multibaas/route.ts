import { NextResponse } from 'next/server'

/**
 * Sepolia on-chain activity, read through MultiBaas.
 *
 * Everything else in this app reads the chains directly, which is fine for current state but poor
 * for history: an RPC log scan over a public endpoint is slow, rate-limited, and gives back raw
 * topics we would have to decode ourselves. MultiBaas indexes the contracts we registered and
 * returns decoded events, so this is the one place a hosted indexer earns its keep.
 *
 * The key stays on the server: MultiBaas keys are bearer tokens with write scope on the deployment.
 */
export async function GET(req: Request) {
  const base = process.env.MULTIBAAS_URL?.replace(/\/$/, '')
  const key = process.env.MULTIBAAS_ACHILLES_READER
  if (!base || !key) return NextResponse.json({ error: 'MultiBaas is not configured' }, { status: 503 })

  const limit = Number(new URL(req.url).searchParams.get('limit') ?? 25)
  const url = `${base}/api/v0/events?limit=${Math.min(limit, 50)}`
  const call = () =>
    fetch(url, {
      headers: { Authorization: `Bearer ${key}` },
      // Events are append-only; a short cache keeps a polling panel from burning the monthly call budget.
      next: { revalidate: 10 },
    })
  // One retry: the hosted endpoint occasionally fails to connect and the throw would surface as an
  // opaque 500 in the panel, even though the next call succeeds in well under a second.
  let r: Response
  try {
    r = await call()
  } catch {
    try {
      r = await call()
    } catch (e) {
      return NextResponse.json({ error: `Could not reach MultiBaas: ${(e as Error).message}` }, { status: 502 })
    }
  }
  const j = await r.json().catch(() => ({}))
  if (!r.ok) return NextResponse.json({ error: j?.message ?? 'MultiBaas request failed' }, { status: r.status })

  type RawEvent = {
    // The contract that emitted it sits under `event.contract`, not at the top level.
    event?: {
      name?: string
      inputs?: { name?: string; value?: unknown }[]
      contract?: { addressAlias?: string; label?: string }
    }
    triggeredAt?: string
    transaction?: { txHash?: string; blockNumber?: number }
  }
  const events = ((j.result ?? []) as RawEvent[]).map((e) => ({
    name: e.event?.name ?? 'Event',
    contract: e.event?.contract?.addressAlias ?? e.event?.contract?.label ?? '',
    at: e.triggeredAt ?? null,
    txHash: e.transaction?.txHash ?? null,
    block: e.transaction?.blockNumber ?? null,
    fields: (e.event?.inputs ?? []).map((i) => ({ name: i.name ?? '', value: String(i.value ?? '') })),
  }))
  return NextResponse.json({ events })
}
