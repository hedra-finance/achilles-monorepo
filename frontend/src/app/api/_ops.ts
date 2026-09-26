import 'server-only'
import {
  createWalletClient,
  getAddress,
  http,
  type Address,
  type Hex
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { chainById, client } from '@/lib/chains'

/**
 * Concurrency on one key. All the server routes sign with the same account, so a visitor asking for
 * gas and test USDC in the same second puts two transactions in flight from it — which the node
 * rejects outright ("in-flight transaction limit reached"), surfacing as a raw 500 on whichever lost.
 *
 * Queue writes in this process and normally wait for a receipt. Explicit wait:false calls release
 * after broadcast and must be treated as pending by the caller. Retry known nonce contention with
 * backoff, but never "already known": that may mean the original transfer was already accepted.
 * This is not a distributed nonce lock or an exactly-once guarantee across serverless instances.
 */
const CONTENDED =
  /in-flight transaction limit|nonce too low|replacement transaction underpriced/i

let opsQueue: Promise<unknown> = Promise.resolve()
function serialize<T>(run: () => Promise<T>): Promise<T> {
  const next = opsQueue.then(run, run)
  opsQueue = next.catch(() => {}) // a failed write must not poison the queue for the next caller
  return next
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * The node's complaint is not always in `message`: viem wraps it, and the phrase we match on can sit
 * in `details` or on the cause. Flatten the whole chain before deciding, so a retryable collision is
 * not missed just because of where the string ended up.
 */
function describe(e: unknown, depth = 0): string {
  if (!e || typeof e !== 'object' || depth > 4) return String(e ?? '')
  const o = e as {
    message?: string
    details?: string
    shortMessage?: string
    cause?: unknown
  }
  return [o.message, o.details, o.shortMessage, describe(o.cause, depth + 1)]
    .filter(Boolean)
    .join(' | ')
}

async function withRetry<T>(send: () => Promise<T>, tries = 5): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await send()
    } catch (e) {
      if (i >= tries || !CONTENDED.test(describe(e))) throw e
      await sleep(1200 * i) // the winner needs a block to land before our nonce is valid
    }
  }
}

/** Server-only ops key — grants allow-list entries (hub ProductAdmin), drips gas, mints test USDC. Never sent to the browser. */
export function opsWallet(chainId: number, opts: { wait?: boolean } = {}) {
  const k = process.env.OPS_PRIVATE_KEY
  if (!k) throw new Error('OPS_PRIVATE_KEY is not set')
  const account = privateKeyToAccount(
    (k.startsWith('0x') ? k : `0x${k}`) as Hex
  )
  const chain = chainById[chainId]
  if (!chain) throw new Error('Unsupported operations chain')
  const wallet = createWalletClient({ account, chain, transport: http() })

  // A broadcast hash is only pending. Estimation cannot guarantee that a mined transaction succeeds.
  const wait = opts.wait !== false
  const run = <T extends Hex>(send: () => Promise<T>) =>
    serialize(async () => {
      const hash = await withRetry(send)
      if (wait) {
        const receipt = await client(chainId).waitForTransactionReceipt({
          hash,
          timeout: 40_000
        })
        if (receipt.status !== 'success')
          throw new Error('Operations transaction reverted')
      }
      return hash
    })

  return {
    ...wallet,
    sendTransaction: ((args: Parameters<typeof wallet.sendTransaction>[0]) =>
      run(() => wallet.sendTransaction(args))) as typeof wallet.sendTransaction,
    writeContract: ((args: Parameters<typeof wallet.writeContract>[0]) =>
      run(() => wallet.writeContract(args))) as typeof wallet.writeContract
  }
}
/**
 * Accepts valid address shapes and normalizes casing for downstream calls.
 */
export function toAddress(a: unknown): Address | null {
  if (typeof a !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(a)) return null
  try {
    return getAddress(a.toLowerCase())
  } catch {
    return null
  }
}
