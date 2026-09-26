import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  accessPhase,
  accessResumeMessage,
  validResumeTime
} from './access-flow.ts'

test('access distinguishes verification, delayed propagation and a resumable registration', () => {
  assert.equal(accessPhase(undefined, false), 'verify')
  assert.equal(accessPhase(undefined, true), 'checking')
  assert.equal(
    accessPhase({ registered: true, granted: false, ready: false }, true),
    'checking'
  )
  assert.equal(
    accessPhase({ registered: true, granted: false, ready: false }, false),
    'resume'
  )
  assert.equal(
    accessPhase({ registered: true, granted: true, ready: false }, false),
    'syncing'
  )
  assert.equal(
    accessPhase({ registered: true, granted: true, ready: true }, true),
    'ready'
  )
})
test('resume authorization expires and binds origin, wallet and product', () => {
  const now = 1_800_000_000_000
  assert.ok(validResumeTime(now, now))
  for (const invalid of [now - 300_001, now + 30_001, NaN, '123', null])
    assert.equal(validResumeTime(invalid, now), false)
  const base = accessResumeMessage('https://example.test', '0xAA', '0x01', now)
  assert.equal(
    base,
    accessResumeMessage('https://example.test', '0xaa', '0x01', now)
  )
  for (const args of [
    ['https://other.test', '0xAA', '0x01', now],
    ['https://example.test', '0xBB', '0x01', now],
    ['https://example.test', '0xAA', '0x02', now],
    ['https://example.test', '0xAA', '0x01', now + 1]
  ] as const)
    assert.notEqual(
      base,
      accessResumeMessage(args[0], args[1], args[2], args[3])
    )
})

test('resume signature is invalid for a substituted wallet, origin or product', async () => {
  const { generatePrivateKey, privateKeyToAccount } =
    await import('viem/accounts')
  const { verifyMessage } = await import('viem')
  // Ephemeral test account; never funded or used by the application.
  const account = privateKeyToAccount(generatePrivateKey())
  const now = Date.now()
  const message = accessResumeMessage(
    'https://example.test',
    account.address,
    '0x01',
    now
  )
  const signature = await account.signMessage({ message })
  assert.equal(
    await verifyMessage({ address: account.address, message, signature }),
    true
  )
  for (const changed of [
    accessResumeMessage('https://other.test', account.address, '0x01', now),
    accessResumeMessage('https://example.test', '0xother', '0x01', now),
    accessResumeMessage('https://example.test', account.address, '0x02', now)
  ])
    assert.equal(
      await verifyMessage({
        address: account.address,
        message: changed,
        signature
      }),
      false
    )
})
