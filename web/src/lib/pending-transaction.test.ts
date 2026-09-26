import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parsePendingTransaction } from './pending-transaction.ts'

const pending = {
  hash: `0x${'a'.repeat(64)}`,
  chain: 11155111,
  owner: `0x${'1'.repeat(40)}`,
  label: 'Deposit request',
  phase: 'transaction'
}
test('pending transaction survives reload with its original account and chain', () => {
  assert.deepEqual(
    parsePendingTransaction(JSON.stringify(pending), [11155111]),
    pending
  )
})
test('malformed or foreign-network pending metadata cannot lock the ticket', () => {
  for (const raw of [
    null,
    '{}',
    'not json',
    JSON.stringify({ ...pending, chain: 1 }),
    JSON.stringify({ ...pending, hash: 'javascript:alert(1)' }),
    JSON.stringify({ ...pending, phase: 'success' })
  ])
    assert.equal(parsePendingTransaction(raw, [11155111]), null)
})
