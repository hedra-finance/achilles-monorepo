import 'server-only'
import { createWalletClient, http, type Address, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { hub, chainById, client } from '@/lib/chains'

/**
 * Every ops write goes through one queue. All the server routes share a single key, so a visitor
 * clicking "gas" and "test USDC" in the same second puts two transactions in flight from one account
 * — which Sepolia rejects outright ("in-flight transaction limit reached"), surfacing as a raw 500 on
 * whichever lost. Serializing costs a few seconds of waiting and removes the failure entirely. The
 * queue is held until the transaction is *mined*, not just sent — releasing at send time would let
 * the next caller broadcast while the first is still pending, which is the same situation the node
 * refuses.
 *
 * ponytail: one in-process queue, so it holds for a single server. Several instances behind a load
 * balancer would need the nonce managed centrally, or a key per route.
 */
let opsQueue: Promise<unknown> = Promise.resolve()
function serialize<T>(run: () => Promise<T>): Promise<T> {
  const next = opsQueue.then(run, run)
  opsQueue = next.catch(() => {}) // a failed write must not poison the queue for the next caller
  return next
}

/** Server-only ops key — grants allow-list entries (hub ProductAdmin), drips gas, mints test USDC. Never sent to the browser. */
export function opsWallet(chainId: number) {
  const k = process.env.OPS_PRIVATE_KEY
  if (!k) throw new Error('OPS_PRIVATE_KEY is not set')
  const account = privateKeyToAccount((k.startsWith('0x') ? k : `0x${k}`) as Hex)
  const chain = chainById[chainId] ?? hub
  const wallet = createWalletClient({ account, chain, transport: http() })
  const mined = async (hash: Hex) => {
    await client(chainId).waitForTransactionReceipt({ hash })
    return hash
  }
  return {
    ...wallet,
    sendTransaction: ((args: Parameters<typeof wallet.sendTransaction>[0]) =>
      serialize(async () => mined(await wallet.sendTransaction(args)))) as typeof wallet.sendTransaction,
    writeContract: ((args: Parameters<typeof wallet.writeContract>[0]) =>
      serialize(async () => mined(await wallet.writeContract(args)))) as typeof wallet.writeContract,
  }
}
export const isAddress = (a: unknown): a is Address => typeof a === 'string' && /^0x[0-9a-fA-F]{40}$/.test(a)
