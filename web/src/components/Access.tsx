'use client'
import { useState } from 'react'
import { useAccount } from 'wagmi'
import { useQueryClient } from '@tanstack/react-query'
import { IDKitRequestWidget, proofOfHuman } from '@worldcoin/idkit'
import { useAccountData } from '@/hooks/data'
import { chainLabel } from '@/lib/chains'
import { PRODUCT } from '@/lib/product'
import { worldIdConfigured } from '@/lib/worldid'

type RpContext = { rp_id: string; nonce: string; created_at: number; expires_at: number; signature: string }
type Ctx = { app_id: `app_${string}`; action: string; rp_context: RpContext }

/**
 * Access — the two ways to become eligible to hold this product's ERC-1404 shares.
 *
 * Senior is the scarce side: a fixed rate ahead of Junior, limited capacity, so one person with
 * fifty wallets could take all of it. That is the moment worth spending a verification on, and
 * proof of human is the least we can ask that still answers it — we need to know the wallets are
 * different people, not who those people are. No passport, no selfie, no PII: the nullifier that
 * comes back is scoped to this action and means only "same person as before" or "new person".
 *
 * Junior is not scarce (it absorbs losses first and has no cap), so it keeps the invite code — and
 * it is the honest fallback for anyone who cancels, has no World App, or is rejected.
 */
export function Access() {
  const { address } = useAccount()
  const acct = useAccountData()
  const qc = useQueryClient()
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null)
  const [ctx, setCtx] = useState<Ctx | null>(null)
  const [open, setOpen] = useState(false)

  async function post(path: string, body: object, label: string) {
    setBusy(label); setMsg(null)
    try {
      const r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error ?? 'failed')
      setMsg({ text: `${label}: done` })
      qc.invalidateQueries({ queryKey: ['account'] })
      return true
    } catch (e) { setMsg({ text: `${label}: ${(e as Error).message}`, bad: true }); return false }
    finally { setBusy(null) }
  }

  /** The widget needs a server-signed context; the RP key never reaches the browser. */
  async function startVerification() {
    setBusy('World ID'); setMsg(null)
    try {
      const r = await fetch('/api/worldid')
      const j = await r.json()
      if (!r.ok) throw new Error(j.error ?? 'could not start verification')
      setCtx(j); setOpen(true)
    } catch (e) { setMsg({ text: `World ID: ${(e as Error).message}`, bad: true }) }
    finally { setBusy(null) }
  }

  if (!address) return null
  const eligible = acct.data?.eligible
  const worldReady = worldIdConfigured()

  return (
    <div className="card">
      <h3>Access</h3>
      <div className="row" style={{ marginBottom: 10 }}>
        <span className={`pill ${eligible ? 'ok' : eligible === false ? 'bad' : ''}`}>
          {eligible ? 'Eligible' : eligible === false ? 'Not eligible yet' : 'Checking…'}
        </span>
        <span className="sub">
          Shares are ERC-1404: only allow-listed wallets can hold them. The grant is recorded on the hub and relayed to each network.
        </span>
      </div>

      {eligible === false && (
        <>
          <div style={{ marginBottom: 12 }}>
            <strong>Senior — one allocation per person</strong>
            <p className="sub" style={{ margin: '2px 0 6px' }}>
              Senior takes a fixed rate before Junior, so its capacity is limited. Verifying you are a distinct
              human keeps one person from taking it across many wallets. We record only a nullifier, never your identity.
            </p>
            {worldReady ? (
              <button className="btn primary" disabled={!!busy} onClick={startVerification}>
                {busy === 'World ID' ? 'Opening…' : 'Verify with World ID'}
              </button>
            ) : (
              <span className="sub">World ID is not configured on this deployment.</span>
            )}
          </div>

          <div>
            <strong>Junior — open</strong>
            <p className="sub" style={{ margin: '2px 0 6px' }}>
              Junior absorbs losses first and has no cap, so it needs no proof of personhood. Use this if you
              cancel, do not have World App, or verification is unavailable.
            </p>
            <div className="row">
              <input className="amt" style={{ fontSize: 15, maxWidth: 220 }} placeholder="Invite code"
                value={code} onChange={(e) => setCode(e.target.value)} />
              <button className="btn" disabled={!!busy || !code}
                onClick={() => post('/api/whitelist', { address, tranche: 'junior', code }, 'Junior access')}>
                {busy === 'Junior access' ? 'Granting…' : 'Get Junior access'}
              </button>
            </div>
          </div>
        </>
      )}

      {ctx && (
        <IDKitRequestWidget
          open={open}
          onOpenChange={setOpen}
          app_id={ctx.app_id}
          action={ctx.action}
          rp_context={ctx.rp_context}
          // Proof of Human is the whole ask: distinctness, not identity. Passport or Selfie Check would
          // collect more than this decision needs.
          preset={proofOfHuman({ signal: address })}
          // v4 only. Accepting legacy proofs would be friendlier to people verified before World ID 4.0,
          // but the same person yields a different nullifier under v3 than under v4 — two namespaces in
          // one registry is a second Senior allocation for anyone who owns both. Scarcity is the whole
          // reason this gate exists, so the stricter setting wins; Junior stays open to everyone else.
          allow_legacy_proofs={false}
          handleVerify={async (proof: unknown) => {
            const ok = await post('/api/whitelist', { address, tranche: 'senior', proof }, 'Senior access')
            // Throwing keeps the widget on its error state instead of showing success we did not get.
            if (!ok) throw new Error('verification rejected')
          }}
          onSuccess={() => setOpen(false)}
        />
      )}

      <div className="row" style={{ marginTop: 10 }}>
        <span className="sub">Need testnet funds?</span>
        {PRODUCT.entryChains.map((c) => (
          <button key={c} className="btn sm" disabled={!!busy}
            onClick={() => post('/api/gas', { address, chainId: c }, `Gas on ${chainLabel(c)}`)}>
            {busy === `Gas on ${chainLabel(c)}` ? 'Sending…' : `Gas on ${chainLabel(c)}`}
          </button>
        ))}
        <button className="btn sm" disabled={!!busy}
          onClick={async () => { if (await post('/api/faucet', { address }, 'Test USDC')) qc.invalidateQueries({ queryKey: ['account'] }) }}>
          {busy === 'Test USDC' ? 'Minting…' : 'Test USDC'}
        </button>
      </div>
      {msg && <p className={msg.bad ? 'err' : 'okmsg'} style={{ marginBottom: 0 }}>{msg.text}</p>}
    </div>
  )
}
