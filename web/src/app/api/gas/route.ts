import { NextResponse } from 'next/server'
import { parseEther } from 'viem'
import { opsWallet, isAddress } from '../_ops'
import { client } from '@/lib/chains'
import { PRODUCT } from '@/lib/product'

const DRIP = { [PRODUCT.sepolia.chainId]: '0.02' } as Record<number, string> // user transactions only happen on Sepolia

/** Testnet gas drip — only tops up when the balance is below the drip amount. */
export async function POST(req: Request) {
  const { address, chainId } = await req.json().catch(() => ({}))
  const amt = DRIP[Number(chainId)]
  if (!isAddress(address) || !amt) return NextResponse.json({ error: 'bad request' }, { status: 400 })
  const pub = client(Number(chainId))
  if ((await pub.getBalance({ address })) >= parseEther(amt)) return NextResponse.json({ ok: true, skipped: true })
  const hash = await opsWallet(Number(chainId)).sendTransaction({ to: address, value: parseEther(amt) })
  await pub.waitForTransactionReceipt({ hash })
  return NextResponse.json({ ok: true, hash })
}
