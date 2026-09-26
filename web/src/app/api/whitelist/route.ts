import { NextResponse } from 'next/server'
import type { Address } from 'viem'
import { opsWallet, isAddress } from '../_ops'
import { hubClient, client } from '@/lib/chains'
import { PRODUCT } from '@/lib/product'
import { PRECOMPILE, permissionsAbi, humanRegistryAbi } from '@/lib/abi'
import { WORLD_ID } from '@/lib/worldid'
import { hashSignal } from '@worldcoin/idkit-core/hashing'
import { getAddress } from 'viem'

/**
 * What `POST /api/v4/verify/{rp_id}` answers with. The nullifier is `nullifier`, not the flat
 * `nullifier_hash` of the older Developer Portal v2 endpoint, and it is repeated per credential
 * under `results`. A reused nullifier still verifies — the reply only notes it in `message` — so
 * uniqueness is ours to enforce, which is what the registry is for.
 */
type VerifyReply = {
  success?: boolean
  nullifier?: string
  environment?: string
  protocol_version?: string
  results?: { identifier: string; success: boolean; nullifier: string }[]
}

/** The one field we read from the proof itself — see the signal check below for why that is sound. */
type ProofResult = { responses?: { identifier: string; signal_hash?: string }[] }

/**
 * Grants a wallet the right to hold this product's ERC-1404 shares, recorded on the hub permissions
 * precompile (0x202) and relayed from there to each spoke.
 *
 * Two tranches, two bars, because they are not equally scarce:
 *   Senior — takes a fixed rate ahead of Junior, so its capacity is limited and worth farming with
 *            many wallets. Gated on World ID Proof of Human: one person, one Senior allocation. The
 *            proof is verified against the World ID protocol and only the nullifier is recorded, so
 *            we learn nothing about who the person is, just that we have not seen them before.
 *   Junior — absorbs losses first and has no capacity limit, so there is nothing to farm. An invite
 *            code is enough, and it stays open to anyone who cannot or will not verify.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  const { address, tranche } = body as { address?: string; tranche?: 'senior' | 'junior' }
  if (!isAddress(address)) return NextResponse.json({ error: 'bad address' }, { status: 400 })

  const vaults = PRODUCT.vaults[PRODUCT.sepolia.chainId]
  const vault = tranche === 'senior' ? vaults.sr : vaults.jr

  if (tranche === 'senior') {
    const gate = await verifyHuman(body, address)
    if ('error' in gate) return NextResponse.json({ error: gate.error }, { status: gate.status })
  } else if (body.code !== (process.env.INVITE_CODE ?? 'ETHGLOBAL')) {
    return NextResponse.json({ error: 'wrong invite code' }, { status: 403 })
  }

  const granted = await grant(address, vault)
  return NextResponse.json({ ok: true, tranche: tranche ?? 'junior', granted })
}

/** Verifies the IDKit proof with World, then binds the nullifier to this wallet on-chain. */
async function verifyHuman(
  body: Record<string, unknown>,
  address: Address,
): Promise<{ nullifierHash: bigint } | { error: string; status: number }> {
  if (!process.env.RP_SIGNING_KEY || !WORLD_ID.rpId) return { error: 'World ID is not configured', status: 503 }
  if (!body.proof) return { error: 'missing proof', status: 400 }

  const res = await fetch(WORLD_ID.verifyUrl(WORLD_ID.rpId), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body.proof),
  })
  const raw_ = await res.text()
  let out: Record<string, unknown> = {}
  try { out = JSON.parse(raw_) } catch { /* non-JSON body is reported below */ }
  if (process.env.NODE_ENV !== 'production') console.log('[worldid] verify', res.status, raw_.slice(0, 600))
  if (!res.ok) return { error: String(out?.detail ?? out?.error ?? 'verification failed'), status: 403 }

  // Everything below is read from the verify reply, never from the proof the browser handed us:
  // the reply is what World attests to, the proof is just the input we asked it to check.
  const reply = out as VerifyReply
  // A staging proof verifying against a production app (or the reverse) would otherwise pass silently.
  if (reply.environment && reply.environment !== WORLD_ID.environment) {
    return { error: `wrong World ID environment: ${reply.environment}`, status: 403 }
  }
  const results = reply.results ?? []
  // Prefer the Proof of Human credential; a single-credential request only ever returns that one.
  const human = results.find((r) => r.identifier === 'proof_of_human' && r.success)
  const raw = human?.nullifier ?? reply.nullifier
  if (!raw) {
    return { error: `verification returned no nullifier (credentials: ${results.map((r) => r.identifier).join(',') || 'none'})`, status: 502 }
  }
  const nullifierHash = BigInt(raw)

  // The proof was requested with the wallet as its signal, so a proof issued for one wallet must not
  // be submittable for another. The signal is a public input to the circuit, so a tampered signal_hash
  // makes verification fail — which is why reading it from the proof is sound once the call above
  // succeeded. It is absent from the verify reply, so the proof is the only place to read it.
  const sent = (body.proof as ProofResult)?.responses?.find((r) => r.identifier === 'proof_of_human')?.signal_hash
  const expected = hashSignal(getAddress(address))
  if (!sent || BigInt(sent) !== BigInt(expected)) {
    if (process.env.NODE_ENV !== 'production') console.log('[worldid] signal', { sent, expected, address })
    return { error: 'this proof was issued for a different wallet', status: 403 }
  }

  // The registry is the record of one-person-one-allocation, so let it be the one that rejects a
  // reuse — checking first and then writing would still race two requests for the same person.
  const registry = PRODUCT.sepolia.humanRegistry
  if (!registry) return { error: 'human registry is not deployed', status: 503 }
  const sepolia = PRODUCT.sepolia.chainId
  try {
    const hash = await opsWallet(sepolia).writeContract({
      address: registry, abi: humanRegistryAbi, functionName: 'claim', args: [nullifierHash, address],
    })
    await client(sepolia).waitForTransactionReceipt({ hash })
  } catch (e) {
    const msg = (e as Error).message ?? ''
    if (/HumanAlreadyClaimed/.test(msg)) return { error: 'this person already claimed a Senior allocation', status: 409 }
    if (/WalletAlreadyClaimed/.test(msg)) return { error: 'this wallet already holds a Senior allocation', status: 409 }
    throw e
  }
  return { nullifierHash }
}

/** Idempotent: the precompile is the source of truth, so re-granting an existing investor is a no-op. */
async function grant(address: Address, vault: Address): Promise<string | null> {
  const chainId = BigInt(PRODUCT.sepolia.chainId)
  const pub = hubClient()
  const already = await pub.readContract({
    address: PRECOMPILE.permissions, abi: permissionsAbi, functionName: 'is_tranche_investor',
    args: [PRODUCT.id, { chain_id: chainId, vault_address: vault }, address],
  })
  if (already) return null
  const hash = await opsWallet(PRODUCT.hubChainId).writeContract({
    address: PRECOMPILE.permissions, abi: permissionsAbi, functionName: 'grant_permission',
    args: [PRODUCT.id, 2, address, { chain_id: chainId, vault_address: vault }],
  })
  await pub.waitForTransactionReceipt({ hash })
  return hash
}
