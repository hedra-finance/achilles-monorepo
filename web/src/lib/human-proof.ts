type RecordValue = Record<string, unknown>
export const isRecord = (value: unknown): value is RecordValue =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

export function uint256(value: unknown): bigint | null {
  if (typeof value !== 'string' || !/^(0x[0-9a-fA-F]+|[0-9]+)$/.test(value))
    return null
  try {
    const number = BigInt(value)
    return number > 0n && number < 2n ** 256n ? number : null
  } catch {
    return null
  }
}

export type ProofPolicy = {
  action: string
  environment: string
  signalHash: string
}

/** Reject alternate actions, legacy namespaces and wallet substitutions before any authorization. */
export function validateHumanProof(
  proof: unknown,
  policy: ProofPolicy
): string | null {
  if (
    !isRecord(proof) ||
    proof.protocol_version !== '4.0' ||
    proof.action !== policy.action ||
    proof.environment !== policy.environment ||
    typeof proof.nonce !== 'string' ||
    !proof.nonce
  ) {
    return 'This verification does not match the Senior access request. Please start again.'
  }
  if (!Array.isArray(proof.responses) || proof.responses.length !== 1)
    return 'A Proof of Human credential is required.'
  const human = proof.responses[0]
  if (
    !isRecord(human) ||
    human.identifier !== 'proof_of_human' ||
    human.issuer_schema_id !== 1 ||
    !Array.isArray(human.proof) ||
    human.proof.length === 0 ||
    !uint256(human.nullifier)
  ) {
    return 'A valid World ID 4.0 Proof of Human is required.'
  }
  if (
    uint256(human.signal_hash) !== uint256(policy.signalHash) ||
    !uint256(policy.signalHash)
  ) {
    return 'This verification belongs to a different wallet. Please start again.'
  }
  return null
}

/** HTTP 200 may contain another successful credential. Require the specific verified human result. */
export function verifiedHumanNullifier(
  reply: unknown,
  proof: unknown,
  policy: ProofPolicy
): bigint | null {
  if (
    validateHumanProof(proof, policy) ||
    !isRecord(proof) ||
    !isRecord(reply) ||
    reply.success !== true ||
    reply.environment !== policy.environment ||
    reply.action !== policy.action ||
    !Array.isArray(reply.results)
  )
    return null
  const human = reply.results.find(
    (r) => isRecord(r) && r.identifier === 'proof_of_human'
  )
  if (!isRecord(human) || human.success !== true) return null
  const verified = uint256(human.nullifier)
  const sent = (proof.responses as RecordValue[])[0]
  return verified !== null && verified === uint256(sent.nullifier)
    ? verified
    : null
}
