import { NextResponse } from 'next/server'
import { parseUnits } from 'viem'
import { opsWallet, toAddress } from '../_ops'
import { client } from '@/lib/chains'
import { PRODUCT } from '@/lib/product'
import { mintableErc20Abi } from '@/lib/abi'

/**
 * Test USDC for the deposit chain. The product is useless to a visitor with an empty wallet, and the
 * asset is a testnet token we control, so we mint rather than hand out a shared pot that runs dry.
 *
 * The top-up threshold is the rate limit: we only ever bring a wallet *up to* GRANT, so repeat calls
 * from the same address are no-ops until it spends. That is the same shape as the gas drip, and it
 * needs no cooldown state to get right.
 */
const GRANT = '1000'

/** A mint plus its receipt runs past the default serverless timeout. */
export const maxDuration = 60

export async function POST(req: Request) {
  const { address: raw } = await req.json().catch(() => ({}))
  const address = toAddress(raw)
  if (!address) return NextResponse.json({ error: 'bad address' }, { status: 400 })

  const chainId = PRODUCT.sepolia.chainId
  const token = PRODUCT.sepolia.usdc
  const pub = client(chainId)
  const decimals = await pub.readContract({ address: token, abi: mintableErc20Abi, functionName: 'decimals' })
  const target = parseUnits(GRANT, decimals)
  const have = await pub.readContract({ address: token, abi: mintableErc20Abi, functionName: 'balanceOf', args: [address] })
  if (have >= target) return NextResponse.json({ ok: true, skipped: true })

  const hash = await opsWallet(chainId).writeContract({
    address: token, abi: mintableErc20Abi, functionName: 'mint', args: [address, target - have],
  })
  await pub.waitForTransactionReceipt({ hash })
  return NextResponse.json({ ok: true, hash })
}
