import { NextResponse } from 'next/server'
import { isRecord } from '@/lib/human-proof'

/** Indexed events only; credentials and the upstream deployment URL stay on the server. */
export async function GET(req: Request) {
  const input = new URL(req.url).searchParams.get('limit')
  const limit = input === null ? 25 : Number(input)
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    return NextResponse.json(
      { error: 'Limit must be an integer from 1 to 50.' },
      { status: 400 }
    )
  }
  const base = process.env.MULTIBAAS_URL?.replace(/\/$/, '')
  const key = process.env.MULTIBAAS_ACHILLES_READER
  if (!base || !key)
    return NextResponse.json(
      { error: 'Indexed activity is not configured on this deployment.' },
      { status: 503 }
    )
  const call = () =>
    fetch(`${base}/api/v0/events?limit=${limit}`, {
      headers: { Authorization: `Bearer ${key}` },
      next: { revalidate: 10 },
      signal: AbortSignal.timeout(8_000)
    })
  try {
    const response = await call().catch(() => call())
    if (!response.ok)
      return NextResponse.json(
        { error: 'Indexed activity is temporarily unavailable.' },
        { status: 502 }
      )
    const data: unknown = await response.json().catch(() => null)
    if (!isRecord(data) || !Array.isArray(data.result))
      throw new Error('Invalid event response')
    const events = data.result.map((entry: unknown) => {
      if (!isRecord(entry) || !isRecord(entry.event))
        throw new Error('Invalid event')
      const event = entry.event
      const contract = isRecord(event.contract) ? event.contract : {}
      const tx = isRecord(entry.transaction) ? entry.transaction : {}
      return {
        name: typeof event.name === 'string' ? event.name : 'Event',
        contract: String(
          contract.addressLabel ?? contract.addressAlias ?? contract.label ?? ''
        ),
        at:
          typeof entry.triggeredAt === 'string' &&
          Number.isFinite(Date.parse(entry.triggeredAt))
            ? entry.triggeredAt
            : null,
        txHash:
          typeof tx.txHash === 'string' && /^0x[0-9a-fA-F]{64}$/.test(tx.txHash)
            ? tx.txHash
            : null,
        block:
          typeof tx.blockNumber === 'number' &&
          Number.isSafeInteger(tx.blockNumber)
            ? tx.blockNumber
            : null,
        fields: Array.isArray(event.inputs)
          ? event.inputs.filter(isRecord).map((i) => ({
              name: String(i.name ?? ''),
              value: String(i.value ?? '')
            }))
          : []
      }
    })
    return NextResponse.json({ events })
  } catch {
    return NextResponse.json(
      { error: 'Could not load indexed activity. Please retry.' },
      { status: 502 }
    )
  }
}
