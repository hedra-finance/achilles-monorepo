// TEMPORARY: testnet presentation override. Disable to restore recorded Junior performance.
// Keep this out of contract reads, balances, share pricing and transaction estimates.
export const JUNIOR_TESTNET_OVERRIDE = true
export const JUNIOR_TESTNET_APR = 23.4
export const JUNIOR_TESTNET_LABEL = 'Testnet APR'
export const juniorTestnetSeries = [
  23.18,
  23.24,
  23.31,
  23.28,
  23.39,
  23.48,
  23.43,
  23.35,
  23.42,
  23.54,
  23.58,
  23.49,
  23.45,
  23.36,
  23.29,
  23.37,
  23.46,
  23.51,
  23.44,
  23.38,
  23.32,
  23.41,
  23.47,
  JUNIOR_TESTNET_APR
] as const
export function juniorDisplayYield(recorded: {
  percent: number | null
  annualized: boolean
}) {
  return JUNIOR_TESTNET_OVERRIDE
    ? { percent: JUNIOR_TESTNET_APR, annualized: true }
    : recorded
}
