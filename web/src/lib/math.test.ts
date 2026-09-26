import { test } from 'node:test'
import assert from 'node:assert/strict'
import { settlementAvgAprPercent, juniorYieldPercent, sqrtPriceToWad, nextSettlement, fmt } from './math.ts'

const d = (h: number) => new Date(h * 3_600_000)

test('avg apr: 1% per day ≈ 365% apr', () => {
  const apr = settlementAvgAprPercent([{ at: d(0), price: 1 }, { at: d(24), price: 1.01 }, { at: d(48), price: 1.0201 }])
  assert.ok(apr !== null && Math.abs(apr - 365.25) < 0.5, String(apr))
})
test('junior yield: short history is not annualized', () => {
  const y = juniorYieldPercent([{ at: d(0), price: 1 }, { at: d(1), price: 1.02 }])
  assert.equal(y.annualized, false)
  assert.ok(y.percent !== null && Math.abs(y.percent - 2) < 1e-9)
})
test('sqrtPriceToWad: price 4 both orientations', () => {
  const sp = 2n * 2n ** 96n // sqrt(4) * 2^96
  assert.equal(sqrtPriceToWad(sp, true), 4n * 10n ** 18n)
  assert.equal(sqrtPriceToWad(sp, false), 10n ** 18n / 4n)
})
test('nextSettlement: cycle end and order close', () => {
  const n = nextSettlement({ start: 1000, length: 600, offset: 100 }, 1650)
  assert.equal(n.cycleEnd.getTime(), 2200_000)
  assert.equal(n.orderClose.getTime(), 2100_000)
})
test('fmt: thousands and fixed decimals', () => {
  assert.equal(fmt(1234567890n, 6), '1,234.56')
  assert.equal(fmt(null, 6), '—')
})
