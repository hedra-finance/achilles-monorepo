import { isRecord } from './human-proof.ts'

export type IndexedContract = {
  address: string
  label: string
  chainId: number
}

/** Only current deployment contracts belong in this product's activity feed. */
export function normalizeIndexedEvents(
  payload: unknown,
  contracts: readonly IndexedContract[]
) {
  if (!isRecord(payload) || !Array.isArray(payload.result))
    throw new Error('Invalid event response')
  const known = new Map(contracts.map((c) => [c.address.toLowerCase(), c]))
  return payload.result.flatMap((entry: unknown) => {
    if (!isRecord(entry) || !isRecord(entry.event))
      throw new Error('Invalid event')
    const event = entry.event
    const contract = isRecord(event.contract) ? event.contract : {}
    const current =
      typeof contract.address === 'string'
        ? known.get(contract.address.toLowerCase())
        : undefined
    if (!current) return []
    const tx = isRecord(entry.transaction) ? entry.transaction : {}
    return [
      {
        name: typeof event.name === 'string' ? event.name : 'Event',
        contract: current.label,
        address: current.address,
        chainId: current.chainId,
        at:
          typeof entry.triggeredAt === 'string' &&
          Number.isFinite(Date.parse(entry.triggeredAt))
            ? entry.triggeredAt
            : null,
        txHash:
          typeof tx.txHash === 'string' && /^0x[0-9a-fA-F]{64}$/.test(tx.txHash)
            ? tx.txHash
            : null,
        block:
          typeof tx.blockNumber === 'number' &&
          Number.isSafeInteger(tx.blockNumber) &&
          tx.blockNumber >= 0
            ? tx.blockNumber
            : null,
        fields: Array.isArray(event.inputs)
          ? event.inputs
              .filter(isRecord)
              .map((i) => ({
                name: String(i.name ?? ''),
                value: String(i.value ?? '')
              }))
          : []
      }
    ]
  })
}
