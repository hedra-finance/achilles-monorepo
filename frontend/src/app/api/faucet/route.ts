import { NextResponse } from 'next/server'
import { parseUnits } from 'viem'
import { opsWallet, toAddress } from '../_ops'
import { client } from '@/lib/chains'
import { PRODUCT } from '@/lib/product'
import { mintableErc20Abi } from '@/lib/abi'
import { isRecord } from '@/lib/human-proof'

export const maxDuration = 60

/** Development token top-up. A balance threshold is not a durable per-person rate limit. */
export async function POST(req: Request) {
  const body: unknown = await req.json().catch(() => null)
  const address = isRecord(body) ? toAddress(body.address) : null
  if (!address)
    return NextResponse.json(
      { error: 'Enter a valid wallet address.' },
      { status: 400 }
    )
  if (!process.env.OPS_PRIVATE_KEY)
    return NextResponse.json(
      { error: 'Test USDC funding is being configured.' },
      { status: 503 }
    )
  try {
    const chainId = PRODUCT.sepolia.chainId
    const token = PRODUCT.sepolia.usdc
    const pub = client(chainId)
    const [decimals, have] = await Promise.all([
      pub.readContract({
        address: token,
        abi: mintableErc20Abi,
        functionName: 'decimals'
      }),
      pub.readContract({
        address: token,
        abi: mintableErc20Abi,
        functionName: 'balanceOf',
        args: [address]
      })
    ])
    const target = parseUnits('1000', decimals)
    if (have >= target) return NextResponse.json({ ok: true, skipped: true })
    const hash = await opsWallet(chainId).writeContract({
      address: token,
      abi: mintableErc20Abi,
      functionName: 'mint',
      args: [address, target - have]
    })
    return NextResponse.json({ ok: true, hash })
  } catch {
    return NextResponse.json(
      {
        error:
          'Funding could not be confirmed. Refresh your balance before retrying.'
      },
      { status: 502 }
    )
  }
}
