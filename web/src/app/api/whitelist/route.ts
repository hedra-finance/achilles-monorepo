import { NextResponse } from 'next/server'
import { opsWallet, isAddress } from '../_ops'
import { hubClient } from '@/lib/chains'
import { PRODUCT } from '@/lib/product'
import { PRECOMPILE, permissionsAbi } from '@/lib/abi'

/** Invite-code allow-listing — grant_permission on the hub permissions precompile (0x202), for both spokes' SR/JR vaults. */
export async function POST(req: Request) {
  const { address, code } = await req.json().catch(() => ({}))
  if (!isAddress(address)) return NextResponse.json({ error: 'bad address' }, { status: 400 })
  if (code !== (process.env.INVITE_CODE ?? 'ETHGLOBAL')) return NextResponse.json({ error: 'wrong invite code' }, { status: 403 })
  const wallet = opsWallet(PRODUCT.hubChainId)
  const pub = hubClient()
  const granted: string[] = []
  for (const [cid, v] of Object.entries(PRODUCT.vaults)) {
    for (const vault of [v.sr, v.jr]) {
      const args = [PRODUCT.id, 2, address, { chain_id: BigInt(cid), vault_address: vault }] as const
      const already = await pub.readContract({ address: PRECOMPILE.permissions, abi: permissionsAbi, functionName: 'is_tranche_investor', args: [PRODUCT.id, { chain_id: BigInt(cid), vault_address: vault }, address] })
      if (already) continue
      const hash = await wallet.writeContract({ address: PRECOMPILE.permissions, abi: permissionsAbi, functionName: 'grant_permission', args })
      await pub.waitForTransactionReceipt({ hash })
      granted.push(hash)
    }
  }
  return NextResponse.json({ ok: true, granted })
}
