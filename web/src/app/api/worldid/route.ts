import { NextResponse } from 'next/server'
import { signRequest } from '@worldcoin/idkit-core/signing'
import { WORLD_ID, worldIdConfigured } from '@/lib/worldid'

export async function GET() {
  const signingKeyHex = process.env.RP_SIGNING_KEY
  if (!signingKeyHex || !worldIdConfigured()) {
    return NextResponse.json(
      { error: 'World ID is not configured on this deployment.' },
      { status: 503 }
    )
  }
  try {
    const { sig, nonce, createdAt, expiresAt } = signRequest({
      signingKeyHex,
      action: WORLD_ID.action
    })
    return NextResponse.json(
      {
        app_id: WORLD_ID.appId,
        action: WORLD_ID.action,
        environment: WORLD_ID.environment,
        rp_context: {
          rp_id: WORLD_ID.rpId,
          nonce,
          created_at: createdAt,
          expires_at: expiresAt,
          signature: sig
        }
      },
      { headers: { 'Cache-Control': 'no-store, private' } }
    )
  } catch {
    return NextResponse.json(
      {
        error: 'World ID could not start verification. Please try again later.'
      },
      { status: 503 }
    )
  }
}
