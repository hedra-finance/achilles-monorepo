/** Illustrative $100 portfolio with $80 Senior / $20 Junior capital. */
export function lossScenario(input: number) {
  const loss = Number.isFinite(input) ? Math.min(100, Math.max(0, input)) : 0
  const juniorLoss = Math.min(20, loss)
  const seniorLoss = Math.max(0, loss - 20)
  return {
    loss,
    junior: 20 - juniorLoss,
    senior: 80 - seniorLoss,
    juniorLoss,
    seniorLoss
  }
}
