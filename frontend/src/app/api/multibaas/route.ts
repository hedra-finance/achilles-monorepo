import { NextResponse } from 'next/server'
import { normalizeIndexedEvents } from '@/lib/indexed-events'
import { PRODUCT } from '@/lib/product'

const contracts = [
  {
    address: PRODUCT.vaults[PRODUCT.sepolia.chainId].sr,
    label: 'Senior vault'
  },
  {
    address: PRODUCT.vaults[PRODUCT.sepolia.chainId].jr,
    label: 'Junior vault'
  },
  { address: PRODUCT.sepolia.lpAdapter, label: 'Stable liquidity adapter' },
  { address: PRODUCT.sepolia.pool, label: 'USDC / USDT pool' },
  {
    address: PRODUCT.sepolia.humanRegistry,
    label: 'Human verification registry'
  }
].map((contract) => ({ ...contract, chainId: PRODUCT.sepolia.chainId }))

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
    const events = normalizeIndexedEvents(data, contracts)
    return NextResponse.json({ events })
  } catch {
    return NextResponse.json(
      { error: 'Could not load indexed activity. Please retry.' },
      { status: 502 }
    )
  }
}
