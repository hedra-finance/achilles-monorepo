import { NextResponse } from 'next/server'
import { parseEther } from 'viem'
import { opsWallet, toAddress } from '../_ops'
import { PRECOMPILE, permissionsAbi } from '@/lib/abi'
import { client, hubClient } from '@/lib/chains'
import { PRODUCT } from '@/lib/product'

const DRIP = { [PRODUCT.sepolia.chainId]: '0.02' } as Record<number, string> // user transactions only happen on Sepolia

export const maxDuration = 60

/** Testnet gas drip — only tops up when the balance is below the drip amount. */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body))
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  const { address: raw, chainId } = body
  const address = toAddress(raw)
  const amt = DRIP[Number(chainId)]
  if (!address || !amt)
    return NextResponse.json({ error: 'bad request' }, { status: 400 })
  if (!process.env.OPS_PRIVATE_KEY || !process.env.NEXT_PUBLIC_HUB_RPC?.trim())
    return NextResponse.json(
      { error: 'Testnet access is being configured. Please try again later.' },
      { status: 503 }
    )
  try {
    const vaults = PRODUCT.vaults[PRODUCT.sepolia.chainId]
    const permissions = await Promise.all(
      [vaults.sr, vaults.jr].map((vault) =>
        hubClient().readContract({
          address: PRECOMPILE.permissions,
          abi: permissionsAbi,
          functionName: 'is_tranche_investor',
          args: [
            PRODUCT.id,
            { chain_id: BigInt(PRODUCT.sepolia.chainId), vault_address: vault },
            address
          ]
        })
      )
    )
    const allowed = permissions.some(Boolean)
    if (!allowed)
      return NextResponse.json(
        { error: 'Activate testnet access before requesting gas.' },
        { status: 403 }
      )
    const pub = client(Number(chainId))
    const balance = await pub.getBalance({ address })
    if (balance >= parseEther(amt))
      return NextResponse.json({ ok: true, skipped: true })
    const hash = await opsWallet(Number(chainId)).sendTransaction({
      to: address,
      value: parseEther(amt) - balance
    })
    return NextResponse.json({ ok: true, hash })
  } catch {
    return NextResponse.json(
      {
        error:
          'The network could not confirm this request. Please check your wallet before retrying.'
      },
      { status: 502 }
    )
  }
}
