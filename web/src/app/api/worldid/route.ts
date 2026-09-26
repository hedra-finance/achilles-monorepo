import { NextResponse } from 'next/server'
import { signRequest } from '@worldcoin/idkit-core/signing'
import { WORLD_ID } from '@/lib/worldid'

/** Short-lived signed context the IDKit widget needs. Signed here because the RP key is a secret. */
export async function GET() {
  const signingKeyHex = process.env.RP_SIGNING_KEY
  if (!signingKeyHex) return NextResponse.json({ error: 'World ID is not configured' }, { status: 503 })

  const { sig, nonce, createdAt, expiresAt } = signRequest({ signingKeyHex, action: WORLD_ID.action })
  return NextResponse.json({
    app_id: WORLD_ID.appId,
    action: WORLD_ID.action,
    rp_context: { rp_id: WORLD_ID.rpId, nonce, created_at: createdAt, expires_at: expiresAt, signature: sig },
  })
}
