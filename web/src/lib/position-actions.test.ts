import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hasPosition, positionActions, ticketHref } from './position-actions.ts'
import { lossScenario } from './risk-scenario.ts'

const empty = {
  shares: 0n,
  deposit: { pending: 0n, claimable: 0n },
  redeem: { pending: 0n, claimable: 0n }
}

test('claims remain actionable alongside newer pending requests and without deposit permission', () => {
  const position = {
    shares: 9n,
    deposit: { pending: 2n, claimable: 3n },
    redeem: { pending: 4n, claimable: 5n }
  }
  const actions = positionActions(position, false)
  assert.deepEqual(
    actions.map((a) => a.label),
    [
      'Claim shares',
      'Claim USDC',
      'Track pending request',
      'Request redemption'
    ]
  )
  assert.equal(actions[0].mode, 'invest')
  assert.equal(actions[1].mode, 'redeem')
  assert.equal(
    ticketHref('Junior', actions[1].mode),
    '/products/stocks-stable?tranche=junior&mode=redeem#invest'
  )
})

test('empty technical positions can be hidden without hiding outstanding funds or requests', () => {
  assert.equal(hasPosition(empty), false)
  assert.equal(hasPosition({ ...empty, shares: 1n }), true)
  for (const kind of ['deposit', 'redeem'] as const)
    for (const field of ['pending', 'claimable'] as const)
      assert.equal(
        hasPosition({ ...empty, [kind]: { ...empty[kind], [field]: 1n } }),
        true
      )
  assert.equal(positionActions(empty, true)[0].label, 'Start a position')
  assert.equal(positionActions(empty, undefined)[0].label, 'Check access')
})

test('loss waterfall conserves value through Junior depletion and total loss', () => {
  for (const loss of [0, 10, 20, 25, 100]) {
    const s = lossScenario(loss)
    assert.equal(s.senior + s.junior + s.loss, 100)
    assert.equal(s.seniorLoss + s.juniorLoss, loss)
    if (loss <= 20) assert.equal(s.senior, 80)
    else assert.equal(s.junior, 0)
  }
  assert.deepEqual(lossScenario(10), {
    loss: 10,
    senior: 80,
    junior: 10,
    seniorLoss: 0,
    juniorLoss: 10
  })
  assert.equal(lossScenario(25).senior, 75)
  assert.equal(lossScenario(-1).loss, 0)
  assert.equal(lossScenario(101).loss, 100)
  assert.equal(lossScenario(NaN).loss, 0)
})
