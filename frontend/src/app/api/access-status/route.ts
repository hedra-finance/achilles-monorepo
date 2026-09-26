import { NextResponse } from 'next/server'
import { toAddress } from '../_ops'
import { client, hubClient } from '@/lib/chains'
import { PRODUCT } from '@/lib/product'
import {
  PRECOMPILE,
  humanRegistryAbi,
  permissionsAbi,
  shareRestrictionAbi,
  trancheSystemAbi
} from '@/lib/abi'

/** Public chain state only. Never grants access or exposes the person's nullifier. */
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams
  const address = toAddress(params.get('address'))
  const type = params.get('tranche')
  if (!address || (type !== 'senior' && type !== 'junior'))
    return NextResponse.json(
      { error: 'Invalid access status request.' },
      { status: 400 }
    )
  try {
    const h = hubClient(),
      c = client(PRODUCT.sepolia.chainId)
    const vault =
      PRODUCT.vaults[PRODUCT.sepolia.chainId][type === 'senior' ? 'sr' : 'jr']
    const [registered, granted, tranches] = await Promise.all([
      type === 'senior'
        ? c.readContract({
            address: PRODUCT.sepolia.humanRegistry,
            abi: humanRegistryAbi,
            functionName: 'isVerified',
            args: [address]
          })
        : Promise.resolve(null),
      h.readContract({
        address: PRECOMPILE.permissions,
        abi: permissionsAbi,
        functionName: 'is_tranche_investor',
        args: [
          PRODUCT.id,
          { chain_id: BigInt(PRODUCT.sepolia.chainId), vault_address: vault },
          address
        ]
      }),
      h.readContract({
        address: PRECOMPILE.trancheSystem,
        abi: trancheSystemAbi,
        functionName: 'get_tranches',
        args: [PRODUCT.id]
      })
    ])
    const tranche = tranches.find(
      (t) =>
        Number(t.vault.chain_id) === PRODUCT.sepolia.chainId &&
        t.vault.vault_address.toLowerCase() === vault.toLowerCase()
    )
    if (!tranche) throw new Error('Tranche unavailable')
    const restriction = await c.readContract({
      address: tranche.shares,
      abi: shareRestrictionAbi,
      functionName: 'detectTransferRestriction',
      args: ['0x0000000000000000000000000000000000000000', address, 0n]
    })
    return NextResponse.json(
      { registered, granted, ready: granted && restriction === 0 },
      { headers: { 'Cache-Control': 'no-store, private' } }
    )
  } catch {
    return NextResponse.json(
      {
        error: 'Access status is temporarily unavailable.',
        code: 'STATUS_UNAVAILABLE'
      },
      { status: 503, headers: { 'Cache-Control': 'no-store' } }
    )
  }
}
