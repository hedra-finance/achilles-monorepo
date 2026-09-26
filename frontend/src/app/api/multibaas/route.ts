import { NextResponse } from 'next/server'
import { normalizeIndexedEvents } from '@/lib/indexed-events'
import { PRODUCT } from '@/lib/product'

const contracts = [
  {
    address: PRODUCT.vaults[PRODUCT.sepolia.chainId].sr,
    label: 'Senior vault',
    category: 'Investments'
  },
  {
    address: PRODUCT.vaults[PRODUCT.sepolia.chainId].jr,
    label: 'Junior vault',
    category: 'Investments'
  },
  {
    address: PRODUCT.sepolia.lpAdapter,
    label: 'Stable liquidity adapter',
    category: 'Liquidity'
  },
  {
    address: PRODUCT.sepolia.pool,
    label: 'USDC / USDT pool',
    category: 'Liquidity'
  },
  {
    address: PRODUCT.sepolia.humanRegistry,
    label: 'Human verification registry',
    category: 'Access'
  }
].map((contract) => ({ ...contract, chainId: PRODUCT.sepolia.chainId }))

/** Indexed events only; credentials and the upstream deployment URL stay on the server. */
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams
  const category = params.get('category') ?? 'All'
  if (!['All', 'Investments', 'Liquidity', 'Access'].includes(category))
    return NextResponse.json(
      { error: 'Invalid activity category.' },
      { status: 400 }
    )
  const selected = contracts.filter(
    (contract) => category === 'All' || contract.category === category
  )
  const input = params.get('limit')
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
  try {
    // Scope before limiting: frequent pool swaps must not displace access or investment records.
    const batches = await Promise.all(
      selected.map(async (contract) => {
        const query = new URLSearchParams({
          limit: String(limit),
          contract_address: contract.address
        })
        const call = () =>
          fetch(`${base}/api/v0/events?${query}`, {
            headers: { Authorization: `Bearer ${key}` },
            next: { revalidate: 10 },
            signal: AbortSignal.timeout(8_000)
          })
        const response = await call().catch(() => call())
        if (!response.ok) throw new Error('Indexed activity unavailable')
        return normalizeIndexedEvents(await response.json(), [contract])
      })
    )
    const events = batches
      .flat()
      .sort(
        (a, b) =>
          (b.block ?? -1) - (a.block ?? -1) ||
          (Date.parse(b.at ?? '') || 0) - (Date.parse(a.at ?? '') || 0)
      )
      .slice(0, limit)
    return NextResponse.json({ events })
  } catch {
    return NextResponse.json(
      { error: 'Could not load indexed activity. Please retry.' },
      { status: 502 }
    )
  }
}
