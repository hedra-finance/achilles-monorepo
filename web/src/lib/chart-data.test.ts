import { test } from 'node:test'
import assert from 'node:assert/strict'
import { distribution, indexStockPrices } from './chart-data.ts'

test('allocation uses exact values and never fills missing or empty portfolios', () => {
  const base = { id: 'a', label: 'A', color: 'blue' }
  assert.equal(distribution([{ ...base, value: null }]), null)
  assert.deepEqual(distribution([{ ...base, value: 0n }]), {
    total: 0n,
    slices: []
  })
  const data = distribution([
    { ...base, value: 3n * 10n ** 30n },
    { ...base, id: 'b', value: 10n ** 30n }
  ])!
  assert.deepEqual(
    data.slices.map((s) => s.percent),
    [75, 25]
  )
})
test('stock chart uses a common baseline and preserves gaps and total losses', () => {
  const data = indexStockPrices(
    [
      { round: 3, at: null, prices: { '0xaa': 0n, '0xbb': 50n } },
      { round: 1, at: null, prices: { '0xaa': 100n } },
      { round: 2, at: null, prices: {} }
    ],
    [
      { token: '0xAA', ticker: 'A', color: 'blue' },
      { token: '0xbb', ticker: 'B', color: 'red' }
    ]
  )
  assert.equal(data.baseline, 1)
  assert.deepEqual(data.series[0].values, [100, null, 0])
  assert.deepEqual(data.series[1].values, [null, null, null])
})
test('zero or missing baseline does not create a synthetic stock price series', () => {
  const data = indexStockPrices(
    [{ round: 1, at: null, prices: { a: 0n } }],
    [{ token: 'a', ticker: 'A', color: 'blue' }]
  )
  assert.equal(data.baseline, null)
  assert.deepEqual(data.points, [])
})
