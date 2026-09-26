import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readIndependently } from './partial-reads.ts'

test('a failing strategy network cannot discard successful entry-network reads', async () => {
  const result = await readIndependently([46630, 11155111], async (chain) => {
    if (chain === 46630) throw new Error('network unavailable')
    return 0n
  })
  assert.equal(result.values[11155111], 0n)
  assert.equal(result.values[46630], undefined)
  assert.deepEqual(result.unavailable, [46630])
})

test('permission denied, permission unknown and permission granted stay distinct', async () => {
  const result = await readIndependently([0, 1, 2], async (index) => {
    if (index === 1) throw new Error('permission unavailable')
    return index === 2
  })
  assert.equal(result.values[0], false)
  assert.equal(result.values[1], undefined)
  assert.equal(result.values[2], true)
})
