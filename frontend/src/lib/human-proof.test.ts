import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  validateHumanProof,
  verifiedHumanNullifier,
  uint256
} from './human-proof.ts'

const policy = {
  action: 'senior-allocation',
  environment: 'production',
  signalHash: '0x1234'
}
const makeProof = () => ({
  protocol_version: '4.0',
  action: policy.action,
  environment: 'production',
  nonce: 'request-nonce',
  responses: [
    {
      identifier: 'proof_of_human',
      issuer_schema_id: 1,
      proof: ['0x1'],
      signal_hash: '0x1234',
      nullifier: '0x99'
    }
  ]
})
const makeReply = () => ({
  success: true,
  action: policy.action,
  environment: 'production',
  results: [{ identifier: 'proof_of_human', success: true, nullifier: '0x99' }]
})

test('accepts only a matching verified human result', () => {
  assert.equal(validateHumanProof(makeProof(), policy), null)
  assert.equal(verifiedHumanNullifier(makeReply(), makeProof(), policy), 153n)
})
test('rejects proofs for another action, wallet, environment or legacy namespace', () => {
  for (const patch of [
    { action: 'another-action' },
    { environment: 'staging' },
    { protocol_version: '3.0' },
    { nonce: '' }
  ]) {
    assert.notEqual(
      validateHumanProof({ ...makeProof(), ...patch }, policy),
      null
    )
  }
  const proof = makeProof()
  proof.responses[0].signal_hash = '0x5678'
  assert.notEqual(validateHumanProof(proof, policy), null)
})
test('HTTP success or an unrelated credential cannot grant access', () => {
  const proof = makeProof()
  assert.equal(
    verifiedHumanNullifier(
      { ...makeReply(), success: false, nullifier: '0x99' },
      proof,
      policy
    ),
    null
  )
  assert.equal(
    verifiedHumanNullifier(
      {
        ...makeReply(),
        results: [{ identifier: 'selfie', success: true, nullifier: '0x99' }],
        nullifier: '0x99'
      },
      proof,
      policy
    ),
    null
  )
  assert.equal(
    verifiedHumanNullifier(
      {
        ...makeReply(),
        results: [
          { identifier: 'proof_of_human', success: false, nullifier: '0x99' }
        ],
        nullifier: '0x99'
      },
      proof,
      policy
    ),
    null
  )
})
test('reply must confirm the expected action, environment and exact nullifier', () => {
  for (const patch of [
    { action: 'another-action' },
    { environment: 'staging' },
    { action: undefined },
    { environment: undefined },
    {
      results: [
        { identifier: 'proof_of_human', success: true, nullifier: '0x98' }
      ]
    }
  ]) {
    assert.equal(
      verifiedHumanNullifier({ ...makeReply(), ...patch }, makeProof(), policy),
      null
    )
  }
})
test('malformed and mixed-credential requests fail without throwing', () => {
  const valid = makeProof()
  for (const value of [
    null,
    [],
    {},
    { ...valid, responses: null },
    { ...valid, responses: [null] },
    { ...valid, responses: [...valid.responses, ...valid.responses] },
    { ...valid, responses: [{ ...valid.responses[0], issuer_schema_id: 11 }] }
  ]) {
    assert.notEqual(validateHumanProof(value, policy), null)
    assert.equal(verifiedHumanNullifier(makeReply(), value, policy), null)
  }
  for (const value of [
    null,
    [],
    {},
    { ...makeReply(), results: null },
    { ...makeReply(), results: [null] }
  ]) {
    assert.equal(verifiedHumanNullifier(value, valid, policy), null)
  }
})
test('nullifiers are bounded nonzero integers, not unsafe JS numbers', () => {
  for (const value of [
    '0x0',
    '-1',
    '1.5',
    'nope',
    '0x',
    (2n ** 256n).toString(),
    153,
    null
  ])
    assert.equal(uint256(value), null)
  assert.equal(uint256((2n ** 256n - 1n).toString()), 2n ** 256n - 1n)
  assert.equal(uint256('0X99'), null)
})
