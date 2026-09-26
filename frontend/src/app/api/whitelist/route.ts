import { NextResponse } from 'next/server'
import { getAddress, type Address, type Hex } from 'viem'
import { accessResumeMessage, validResumeTime } from '@/lib/access-flow'
import { hashSignal } from '@worldcoin/idkit-core/hashing'
import { opsWallet, toAddress } from '../_ops'
import { hubClient, client } from '@/lib/chains'
import { PRODUCT } from '@/lib/product'
import { PRECOMPILE, permissionsAbi, humanRegistryAbi } from '@/lib/abi'
import { WORLD_ID, worldIdConfigured } from '@/lib/worldid'
import {
  isRecord,
  validateHumanProof,
  verifiedHumanNullifier
} from '@/lib/human-proof'

export const maxDuration = 60
const error = (message: string, status: number, code = 'INVALID_REQUEST') => {
  // Stable diagnostic codes only: never log proofs, nullifiers or RPC details.
  console.warn('[access]', code, status)
  return NextResponse.json({ error: message, code }, { status })
}

/** Senior uses World ID; an invite grants Junior only. No public fallback invite code. */
export async function POST(req: Request) {
  const body: unknown = await req.json().catch(() => null)
  if (!isRecord(body)) return error('Invalid request.', 400)
  const address = toAddress(body.address)
  const tranche = body.tranche
  if (!address || (tranche !== 'senior' && tranche !== 'junior'))
    return error('Select a valid wallet and tranche.', 400)
  if (
    !process.env.OPS_PRIVATE_KEY ||
    !process.env.NEXT_PUBLIC_HUB_RPC?.trim()
  ) {
    return error(
      'Testnet access is being configured. Please try again later.',
      503
    )
  }
  let stage = 'PROOF_VERIFICATION'
  try {
    if (tranche === 'senior' && body.resume === true) {
      stage = 'RESUME_AUTHORIZATION'
      if (
        !validResumeTime(body.issuedAt) ||
        typeof body.signature !== 'string' ||
        !/^0x[0-9a-fA-F]+$/.test(body.signature)
      )
        return error(
          'Please sign a fresh request to complete access.',
          400,
          'RESUME_EXPIRED'
        )
      const c = client(PRODUCT.sepolia.chainId)
      const verified = await c.verifyMessage({
        address,
        message: accessResumeMessage(
          new URL(req.url).origin,
          address,
          PRODUCT.idHex,
          body.issuedAt
        ),
        signature: body.signature as Hex
      })
      if (!verified)
        return error(
          'The signature does not match this wallet.',
          403,
          'RESUME_SIGNATURE_INVALID'
        )
      const registered = await c.readContract({
        address: PRODUCT.sepolia.humanRegistry,
        abi: humanRegistryAbi,
        functionName: 'isVerified',
        args: [address]
      })
      if (!registered)
        return error(
          'Complete World ID verification first.',
          403,
          'REGISTRATION_REQUIRED'
        )
    } else if (tranche === 'senior') {
      const rejected = await verifyHuman(body.proof, address, (next) => {
        stage = next
      })
      if (rejected)
        return error(rejected.message, rejected.status, rejected.code)
    } else {
      const expected = process.env.INVITE_CODE?.trim()
      if (!expected)
        return error(
          'Junior access is being configured. Please try again later.',
          503
        )
      if (typeof body.code !== 'string' || body.code.trim() !== expected)
        return error('The invite code is incorrect.', 403)
    }
    stage = 'GRANT_SUBMISSION'
    const vaults = PRODUCT.vaults[PRODUCT.sepolia.chainId]
    const granted = await grant(
      address,
      tranche === 'senior' ? vaults.sr : vaults.jr
    )
    return NextResponse.json({
      ok: true,
      tranche,
      granted,
      pending: granted !== null
    })
  } catch {
    if (
      tranche === 'senior' &&
      (stage === 'REGISTRY_CONFIRMATION' || stage === 'GRANT_SUBMISSION')
    ) {
      // The human proof (or signed resume) passed. Network settlement is a separate stage.
      console.warn('[access]', `${stage}_PENDING`, 202)
      return NextResponse.json(
        { ok: true, tranche, pending: true, stage, code: `${stage}_PENDING` },
        { status: 202 }
      )
    }
    return error(
      'We could not finish this request. Check your access status before starting again.',
      502,
      `${stage}_UNAVAILABLE`
    )
  }
}

async function verifyHuman(
  proof: unknown,
  address: Address,
  onStage: (stage: string) => void
): Promise<{ message: string; status: number; code: string } | null> {
  if (
    !process.env.RP_SIGNING_KEY ||
    !worldIdConfigured() ||
    !PRODUCT.sepolia.humanRegistry
  ) {
    return {
      message: 'World ID access is not configured on this deployment.',
      status: 503,
      code: 'WORLD_NOT_CONFIGURED'
    }
  }
  const policy = {
    action: WORLD_ID.action,
    environment: WORLD_ID.environment,
    signalHash: hashSignal(getAddress(address))
  }
  const invalid = validateHumanProof(proof, policy)
  if (invalid) {
    const code = !isRecord(proof)
      ? 'PROOF_FORMAT'
      : proof.protocol_version !== '4.0'
        ? 'PROOF_VERSION'
        : proof.action !== policy.action
          ? 'PROOF_ACTION'
          : proof.environment !== policy.environment
            ? 'PROOF_ENVIRONMENT'
            : typeof proof.nonce !== 'string' || !proof.nonce
              ? 'PROOF_NONCE'
              : invalid.includes('different wallet')
                ? 'PROOF_WALLET'
                : 'PROOF_CREDENTIAL'
    return { message: invalid, status: 400, code }
  }
  const response = await fetch(WORLD_ID.verifyUrl(WORLD_ID.rpId), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(proof),
    cache: 'no-store',
    signal: AbortSignal.timeout(8_000)
  })
  if (!response.ok)
    return {
      message:
        'World ID could not verify this request. Please try a new verification.',
      status: response.status >= 500 ? 502 : 403,
      code: 'WORLD_PROOF_REJECTED'
    }
  const nullifier = verifiedHumanNullifier(
    await response.json().catch(() => null),
    proof,
    policy
  )
  if (nullifier === null)
    return {
      message:
        'World ID did not confirm the required human credential for this action.',
      status: 403,
      code: 'WORLD_CREDENTIAL_UNCONFIRMED'
    }

  onStage('REGISTRY_CONFIRMATION')
  const registry = PRODUCT.sepolia.humanRegistry
  const sepolia = PRODUCT.sepolia.chainId
  const publicClient = client(sepolia)
  const binding = async () => {
    const [wallet, registered] = await Promise.all([
      publicClient.readContract({
        address: registry,
        abi: humanRegistryAbi,
        functionName: 'walletOf',
        args: [nullifier]
      }),
      publicClient.readContract({
        address: registry,
        abi: humanRegistryAbi,
        functionName: 'nullifierOf',
        args: [address]
      })
    ])
    return {
      same:
        wallet.toLowerCase() === address.toLowerCase() &&
        registered === nullifier,
      conflict:
        BigInt(wallet) !== 0n
          ? 'This person already registered Senior access with another wallet. Use the original wallet, or explore Junior.'
          : registered !== 0n
            ? 'This wallet already holds another human’s Senior registration. Use the matching World ID, or explore Junior.'
            : null
    }
  }
  const existing = await binding()
  // A previous registry write may have succeeded before the Hub grant failed. Resume that exact binding.
  if (existing.same) return null
  if (existing.conflict)
    return {
      message: existing.conflict,
      status: 409,
      code: 'REGISTRATION_CONFLICT'
    }
  try {
    await opsWallet(sepolia).writeContract({
      address: registry,
      abi: humanRegistryAbi,
      functionName: 'claim',
      args: [nullifier, address]
    })
  } catch {
    // The contract, not this read-before-write, atomically enforces uniqueness across concurrent requests.
    const after = await binding()
    if (after.same) return null
    if (after.conflict)
      return {
        message: after.conflict,
        status: 409,
        code: 'REGISTRATION_CONFLICT'
      }
    throw new Error('Human registration could not be confirmed')
  }
  return null
}

async function grant(address: Address, vault: Address): Promise<string | null> {
  const descriptor = {
    chain_id: BigInt(PRODUCT.sepolia.chainId),
    vault_address: vault
  }
  const already = await hubClient().readContract({
    address: PRECOMPILE.permissions,
    abi: permissionsAbi,
    functionName: 'is_tranche_investor',
    args: [PRODUCT.id, descriptor, address]
  })
  if (already) return null
  return opsWallet(PRODUCT.hubChainId, { wait: false }).writeContract({
    address: PRECOMPILE.permissions,
    abi: permissionsAbi,
    functionName: 'grant_permission',
    args: [PRODUCT.id, 2, address, descriptor]
  })
}
