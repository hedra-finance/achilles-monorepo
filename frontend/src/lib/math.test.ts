import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  settlementAvgAprPercent,
  displayYieldPercent,
  sqrtPriceToWad,
  nextSettlement,
  fmt,
  parseTokenAmount,
  holdingValueWad,
  priceChangePercent
} from './math.ts'

const d = (h: number) => new Date(h * 3_600_000)

test('stock values respect token decimals and preserve missing versus zero', () => {
  assert.equal(
    holdingValueWad(1_500_000n, 225n * 10n ** 18n, 6),
    3375n * 10n ** 17n
  )
  assert.equal(
    holdingValueWad(15n * 10n ** 17n, 225n * 10n ** 18n, 18),
    3375n * 10n ** 17n
  )
  assert.equal(holdingValueWad(0n, 225n * 10n ** 18n, 6), 0n)
  assert.equal(holdingValueWad(1n, null, 6), null)
  assert.equal(holdingValueWad(null, 10n ** 18n, 6), null)
})

test('price comparison handles missing baselines and a complete price loss', () => {
  assert.equal(priceChangePercent(125n, 100n), 25)
  assert.equal(priceChangePercent(75n, 100n), -25)
  assert.equal(priceChangePercent(0n, 100n), -100)
  assert.equal(priceChangePercent(100n, 0n), null)
  assert.equal(priceChangePercent(100n, null), null)
})

test('avg apr: 1% per day ≈ 365% apr', () => {
  const apr = settlementAvgAprPercent([
    { at: d(0), price: 1 },
    { at: d(24), price: 1.01 },
    { at: d(48), price: 1.0201 }
  ])
  assert.ok(apr !== null && Math.abs(apr - 365.25) < 0.5, String(apr))
})
test('tranche yield: short history is not annualized', () => {
  const y = displayYieldPercent([
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
    displayYieldPercent([
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

test('entry cost over a few hours stays a period loss instead of a projected APR', () => {
  const result = displayYieldPercent([
    { at: d(0), price: 1 },
    { at: d(2), price: 0.994 }
  ])
  assert.equal(result.annualized, false)
  assert.ok(result.percent !== null && Math.abs(result.percent + 0.6) < 1e-9)
})
