'use client'
import { useState } from 'react'
import { useAccount } from 'wagmi'
import { useQueryClient } from '@tanstack/react-query'
import { useAccountData } from '@/hooks/data'
import { chainLabel } from '@/lib/chains'
import { PRODUCT } from '@/lib/product'

/** Access — invite-code allow-listing and a testnet gas drip. Both go through server routes holding the ops key. */
export function Access() {
  const { address } = useAccount()
  const acct = useAccountData()
  const qc = useQueryClient()
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  async function post(path: string, body: object, label: string) {
    setBusy(label); setMsg(null)
    try {
      const r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error ?? 'failed')
      setMsg(`${label}: done`)
      qc.invalidateQueries({ queryKey: ['account'] })
    } catch (e) { setMsg(`${label}: ${(e as Error).message}`) } finally { setBusy(null) }
  }
  if (!address) return null
  const eligible = acct.data?.eligible
  return (
    <div className="card">
      <h3>Access</h3>
      <div className="row" style={{ marginBottom: 10 }}>
        <span className={`pill ${eligible ? 'ok' : eligible === false ? 'bad' : ''}`}>{eligible ? 'Whitelisted' : eligible === false ? 'Not whitelisted' : 'Checking…'}</span>
        <span className="sub">Shares are ERC-1404: only whitelisted wallets can hold them. The grant is recorded on the hub and relayed to each network.</span>
      </div>
      {eligible === false && (
        <div className="row">
          <input className="amt" style={{ fontSize: 15, maxWidth: 220 }} placeholder="Invite code" value={code} onChange={(e) => setCode(e.target.value)} />
          <button className="btn primary" disabled={!!busy || !code} onClick={() => post('/api/whitelist', { address, code }, 'Whitelist')}>{busy === 'Whitelist' ? 'Granting…' : 'Get access'}</button>
        </div>
      )}
      <div className="row" style={{ marginTop: 10 }}>
        <span className="sub">Need testnet gas?</span>
        {PRODUCT.entryChains.map((c) => (
          <button key={c} className="btn sm" disabled={!!busy} onClick={() => post('/api/gas', { address, chainId: c }, `Gas on ${chainLabel(c)}`)}>{chainLabel(c)}</button>
        ))}
      </div>
      {msg && <p className="sub" style={{ marginBottom: 0 }}>{msg}</p>}
    </div>
  )
}
