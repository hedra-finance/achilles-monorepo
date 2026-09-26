import type { Hex } from 'viem'

export type PendingTransaction = {
  hash: Hex
  chain: number
  owner: string
  label: string
  phase: 'approval' | 'transaction'
}

/** Recover public transaction metadata only; never store signatures or wallet keys. */
export function parsePendingTransaction(
  raw: string | null,
  entryChains: readonly number[]
): PendingTransaction | null {
  try {
    const value: unknown = JSON.parse(raw ?? 'null')
    if (!value || typeof value !== 'object') return null
    const p = value as Partial<PendingTransaction>
    if (
      typeof p.hash !== 'string' ||
      !/^0x[0-9a-fA-F]{64}$/.test(p.hash) ||
      typeof p.owner !== 'string' ||
      !/^0x[0-9a-fA-F]{40}$/.test(p.owner) ||
      typeof p.chain !== 'number' ||
      !entryChains.includes(p.chain) ||
      (p.phase !== 'approval' && p.phase !== 'transaction') ||
      typeof p.label !== 'string' ||
      ![
        'Deposit request',
        'Redemption request',
        'Share claim',
        'USDC claim'
      ].includes(p.label)
    )
      return null
    return p as PendingTransaction
  } catch {
    return null
  }
}
