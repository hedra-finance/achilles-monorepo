import 'server-only'
import { createWalletClient, http, type Address, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { hub, chainById } from '@/lib/chains'

/** Server-only ops key — grants allow-list entries (hub ProductAdmin) and drips gas. Never sent to the browser. */
export function opsWallet(chainId: number) {
  const k = process.env.OPS_PRIVATE_KEY
  if (!k) throw new Error('OPS_PRIVATE_KEY is not set')
  const account = privateKeyToAccount((k.startsWith('0x') ? k : `0x${k}`) as Hex)
  const chain = chainById[chainId] ?? hub
  return createWalletClient({ account, chain, transport: http() })
}
export const isAddress = (a: unknown): a is Address => typeof a === 'string' && /^0x[0-9a-fA-F]{40}$/.test(a)
