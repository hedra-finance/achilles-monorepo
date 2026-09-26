import { NextResponse } from 'next/server'
import { getAddress, type Address } from 'viem'
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
const error = (message: string, status: number) =>
  NextResponse.json({ error: message }, { status })

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
  try {
    if (tranche === 'senior') {
      const rejected = await verifyHuman(body.proof, address)
      if (rejected) return error(rejected.message, rejected.status)
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
    return error(
      'Access could not be confirmed. Check the current permission state and retry; a completed verification can be resumed.',
      502
    )
  }
}

async function verifyHuman(
  proof: unknown,
  address: Address
): Promise<{ message: string; status: number } | null> {
  if (
    !process.env.RP_SIGNING_KEY ||
    !worldIdConfigured() ||
    !PRODUCT.sepolia.humanRegistry
  ) {
    return {
      message: 'World ID access is not configured on this deployment.',
      status: 503
    }
  }
  const policy = {
    action: WORLD_ID.action,
    environment: WORLD_ID.environment,
    signalHash: hashSignal(getAddress(address))
  }
  const invalid = validateHumanProof(proof, policy)
  if (invalid) return { message: invalid, status: 400 }
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
      status: response.status >= 500 ? 502 : 403
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
      status: 403
    }

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
      occupied: BigInt(wallet) !== 0n || registered !== 0n
    }
  }
  const existing = await binding()
  // A previous registry write may have succeeded before the Hub grant failed. Resume that exact binding.
  if (existing.same) return null
  if (existing.occupied)
    return {
      message:
        'This human or wallet is already linked to another Senior access registration.',
      status: 409
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
    if (after.occupied)
      return {
        message:
          'This human or wallet is already registered for Senior access.',
        status: 409
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
