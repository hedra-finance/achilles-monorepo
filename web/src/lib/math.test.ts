import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  settlementAvgAprPercent,
  juniorYieldPercent,
  sqrtPriceToWad,
  nextSettlement,
  fmt,
  parseTokenAmount
} from './math.ts'

const d = (h: number) => new Date(h * 3_600_000)

test('avg apr: 1% per day ≈ 365% apr', () => {
  const apr = settlementAvgAprPercent([
    { at: d(0), price: 1 },
    { at: d(24), price: 1.01 },
    { at: d(48), price: 1.0201 }
  ])
  assert.ok(apr !== null && Math.abs(apr - 365.25) < 0.5, String(apr))
})
test('junior yield: short history is not annualized', () => {
  const y = juniorYieldPercent([
    { at: d(0), price: 1 },
    { at: d(1), price: 1.02 }
  ])
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

test('amount input rejects rounding, negative values, exponents and invalid input', () => {
  for (const input of ['', '.', '-1', '1e6', '1,000', '0.0000001'])
    assert.equal(parseTokenAmount(input, 6), null)
  assert.equal(
    parseTokenAmount('9007199254740993.123456', 6),
    9007199254740993123456n
  )
  assert.equal(parseTokenAmount('.5', 6), 500000n)
})
test('formatting preserves integers larger than the safe number range', () => {
  assert.equal(fmt(9007199254740993123456n, 6), '9,007,199,254,740,993.12')
  assert.equal(fmt(-1000n, 6, 4), '-0.0010')
})
test('zero share price reports a total loss instead of disappearing', () => {
  assert.deepEqual(
    juniorYieldPercent([
      { at: d(0), price: 1 },
      { at: d(1), price: 0 }
    ]),
    { percent: -100, annualized: false }
  )
  assert.equal(
    settlementAvgAprPercent([
      { at: d(0), price: 0 },
      { at: d(1), price: 1 }
    ]),
    null
  )
})
