import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeIndexedEvents } from './indexed-events.ts'

const address = `0x${'a'.repeat(40)}`
const contracts = [{ address, label: 'Senior vault', chainId: 11155111 }]
const entry = {
  event: {
    name: 'DepositRequest',
    contract: { address, addressAlias: 'arbitrary-indexer-label' },
    inputs: []
  },
  transaction: { txHash: `0x${'b'.repeat(64)}`, blockNumber: 100 },
  triggeredAt: '2026-09-26T09:00:00Z'
}
test('indexed activity is scoped to current deployment addresses, not indexer labels', () => {
  const events = normalizeIndexedEvents(
    {
      result: [
        entry,
        {
          ...entry,
          event: {
            ...entry.event,
            contract: { address: `0x${'c'.repeat(40)}` }
          }
        },
        {
          ...entry,
          event: { ...entry.event, contract: { addressAlias: 'Senior vault' } }
        }
      ]
    },
    contracts
  )
  assert.equal(events.length, 1)
  assert.equal(events[0].contract, 'Senior vault')
  assert.equal(events[0].chainId, 11155111)
  assert.equal(events[0].txHash, entry.transaction.txHash)
})
test('malformed indexed data is an error, while unsafe transaction metadata cannot become links', () => {
  assert.throws(() => normalizeIndexedEvents({ result: {} }, contracts))
  assert.throws(() => normalizeIndexedEvents({ result: [null] }, contracts))
  const [event] = normalizeIndexedEvents(
    {
      result: [
        {
          ...entry,
          triggeredAt: 'invalid',
          transaction: { txHash: 'javascript:alert(1)', blockNumber: -1 }
        }
      ]
    },
    contracts
  )
  assert.equal(event.at, null)
  assert.equal(event.txHash, null)
  assert.equal(event.block, null)
})
