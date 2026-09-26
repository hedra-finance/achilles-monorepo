'use client'
import { useState } from 'react'
import { useAccount } from 'wagmi'
import { useQueryClient } from '@tanstack/react-query'
import { useAccountData } from '@/hooks/data'
import { hubConfigured } from '@/lib/chains'
import { PRODUCT } from '@/lib/product'
import { Icon } from './Icon'

export function Access() {
  const { address } = useAccount()
  const acct = useAccountData()
  const qc = useQueryClient()
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  async function post(path: string, body: object, label: string) {
    setBusy(label)
    setMsg(null)
    try {
      const r = await fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      })
      const j = await r.json().catch(() => null)
      if (!r.ok)
        throw new Error(
          j?.error ?? 'The service is unavailable. Please try again.'
        )
      setMsg({
        ok: true,
        text:
          label === 'Access'
            ? 'Access granted on the hub. It may take a moment to reach the vault.'
            : j?.skipped
              ? 'Your wallet already has enough testnet gas.'
              : 'Testnet gas sent to your wallet.'
      })
      void qc.invalidateQueries({ queryKey: ['account'] })
    } catch (e) {
      setMsg({
        ok: false,
        text: e instanceof Error ? e.message : 'Could not complete the request.'
      })
    } finally {
      setBusy(null)
    }
  }
  if (!address) return null
  const eligible = acct.data?.eligible
  return (
    <section className="card access-card" aria-label="Testnet access">
      <div className="access-status">
        <h3 style={{ margin: 0 }}>Testnet access</h3>
        <span className={'pill ' + (eligible ? 'ok' : '')}>
          {acct.isError
            ? 'Unavailable'
            : eligible
              ? 'Approved'
              : eligible === false
                ? 'Invite required'
                : !hubConfigured
                  ? 'Not connected'
                  : 'Checking…'}
        </span>
      </div>
      <p>
        Approved wallets can hold shares in this strategy. Use your team invite
        to request access.
      </p>
      {eligible !== true && (
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault()
            if (code.trim())
              void post(
                '/api/whitelist',
                { address, code: code.trim() },
                'Access'
              )
          }}
        >
          <label className="sr-only" htmlFor="invite-code">
            Invite code
          </label>
          <input
            id="invite-code"
            className="amt"
            autoComplete="off"
            placeholder="Invite code"
            value={code}
            disabled={!!busy}
            onChange={(e) => setCode(e.target.value)}
          />
          <button className="btn sm" disabled={!!busy || !code.trim()}>
            {busy === 'Access' ? 'Requesting…' : 'Get access'}
          </button>
        </form>
      )}
      <div className="faucet-row">
        <span>
          <Icon name="info" size={12} /> Need testnet gas?
        </span>
        <button
          className="btn sm"
          disabled={!!busy || eligible !== true}
          onClick={() =>
            post(
              '/api/gas',
              { address, chainId: PRODUCT.entryChains[0] },
              'Gas'
            )
          }
        >
          {busy === 'Gas' ? 'Sending…' : 'Get Sepolia ETH'}
        </button>
      </div>
      {msg && (
        <p
          role="status"
          className={msg.ok ? 'okmsg' : 'err'}
          style={{ margin: '12px 0 0' }}
        >
          {msg.text}
        </p>
      )}
    </section>
  )
}
