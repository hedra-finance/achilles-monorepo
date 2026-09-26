'use client'
import { useState } from 'react'
import dynamic from 'next/dynamic'
import { getAddress } from 'viem'
import { worldIdConfigured } from '@/lib/worldid'
import type { WorldContext } from './WorldVerification'
const WorldVerification = dynamic(() => import('./WorldVerification'), {
  ssr: false
})
import { useSwitchChain } from 'wagmi'
import { useWalletAccount } from '@/hooks/wallet'
import { useAppKit } from '@reown/appkit/react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { client, hubConfigured } from '@/lib/chains'
import { PRODUCT } from '@/lib/product'
import { erc20Abi } from '@/lib/abi'
import { fmt, short } from '@/lib/math'
import { Icon } from './Icon'

export function Access({
  eligible,
  type,
  mode,
  shares,
  onChooseJunior,
  disabled = false
}: {
  eligible: boolean | undefined
  type: 'Senior' | 'Junior'
  mode: 'invest' | 'redeem'
  shares?: bigint
  onChooseJunior: () => void
  disabled?: boolean
}) {
  const { address, chainId } = useWalletAccount()
  const { switchChainAsync } = useSwitchChain()
  const { open } = useAppKit()
  const qc = useQueryClient()
  const [code, setCode] = useState('')
  const [worldContext, setWorldContext] = useState<WorldContext | null>(null)
  const [accessPending, setAccessPending] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const funds = useQuery({
    queryKey: ['funding', address],
    enabled: !!address,
    refetchInterval: 15_000,
    queryFn: async () => {
      const c = client(PRODUCT.sepolia.chainId)
      const [gas, usdc] = await Promise.all([
        c.getBalance({ address: address! }),
        c.readContract({
          address: PRODUCT.sepolia.usdc,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [address!]
        })
      ])
      return { gas, usdc }
    }
  })
  const connected = !!address && chainId === PRODUCT.sepolia.chainId
  const hasGas = funds.data != null && funds.data.gas > 0n
  const hasAssets =
    mode === 'invest'
      ? funds.data != null && funds.data.usdc > 0n
      : shares != null && shares > 0n
  const steps = [
    { name: 'Wallet', done: connected },
    ...(mode === 'invest' ? [{ name: 'Access', done: eligible === true }] : []),
    { name: 'Gas', done: hasGas },
    { name: mode === 'invest' ? 'USDC' : 'Shares', done: hasAssets }
  ]
  const done = steps.filter((s) => s.done).length
  const blocked = disabled || !!busy || !!worldContext
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
            ? j?.pending
              ? 'Access request submitted. Waiting for the permission to reach your vault.'
              : 'Access is registered. Checking your vault permission.'
            : j?.skipped
              ? `Your wallet already has enough ${label === 'USDC' ? 'test USDC' : 'testnet ETH'}.`
              : `${label === 'USDC' ? 'Test USDC' : 'Testnet ETH'} confirmed. Refreshing your balance.`
      })
      if (label === 'Access') setAccessPending(true)
      void qc.invalidateQueries({ queryKey: ['account'] })
      void qc.invalidateQueries({ queryKey: ['funding'] })
      return true
    } catch (e) {
      setMsg({
        ok: false,
        text: e instanceof Error ? e.message : 'Could not complete the request.'
      })
      return false
    } finally {
      setBusy(null)
    }
  }
  async function startWorld() {
    setBusy('World ID')
    setMsg(null)
    try {
      const response = await fetch('/api/worldid', { cache: 'no-store' })
      const data = await response.json().catch(() => null)
      if (!response.ok || !data?.rp_context)
        throw new Error(
          data?.error ?? 'Verification is temporarily unavailable.'
        )
      setWorldContext(data)
    } catch (error) {
      setMsg({
        ok: false,
        text:
          error instanceof Error
            ? error.message
            : 'Could not start verification.'
      })
    } finally {
      setBusy(null)
    }
  }
  return (
    <details className="investment-access" open={done < steps.length}>
      <summary>
        <span>
          <Icon name="shield" size={15} />
          {done === steps.length
            ? 'Wallet prerequisites checked'
            : 'Prepare your wallet'}
        </span>
        <small>
          {done} / {steps.length}
          <Icon name="chevron" size={12} />
        </small>
      </summary>
      <div className="readiness-track" aria-label="Investment prerequisites">
        {steps.map((s, i) => (
          <div key={s.name} className={s.done ? 'done' : ''}>
            <span>{s.done ? <Icon name="check" size={11} /> : i + 1}</span>
            <small>{s.name}</small>
          </div>
        ))}
      </div>
      <div className="readiness-actions">
        {!connected && (
          <div className="readiness-action">
            <p>
              {address
                ? 'Switch to Sepolia to submit your request.'
                : 'Connect a wallet to check balances and access.'}
            </p>
            <button
              className="btn sm"
              disabled={blocked}
              onClick={async () => {
                if (!address) {
                  void open()
                  return
                }
                setBusy('Network')
                setMsg(null)
                try {
                  await switchChainAsync({ chainId: PRODUCT.sepolia.chainId })
                } catch {
                  setMsg({
                    ok: false,
                    text: 'Network switch cancelled or unavailable. Select Sepolia in your wallet and retry.'
                  })
                } finally {
                  setBusy(null)
                }
              }}
            >
              {address ? 'Switch to Sepolia' : 'Connect wallet'}
            </button>
          </div>
        )}
        {address && mode === 'invest' && eligible !== true && (
          <div className="tranche-access">
            <div className="access-policy-title">
              <Icon name={type === 'Senior' ? 'shield' : 'layers'} size={17} />
              <strong>{type} access</strong>
            </div>
            {accessPending && (
              <p className="access-pending" role="status">
                <Icon name="clock" size={14} />
                Permission is syncing. We check it automatically; your deposit
                unlocks after confirmation.
              </p>
            )}
            {type === 'Senior' ? (
              <>
                <p>
                  World ID links one verified human to one wallet for Senior
                  access. Achilles receives a verification proof, not your
                  personal identity details.
                </p>
                <p className="market-disclosure">
                  This prevents duplicate human registrations. It is not KYC,
                  proof of investment eligibility, or a limit on deposit size.
                </p>
                {worldIdConfigured() ? (
                  <button
                    className="btn primary sm"
                    disabled={blocked || !hubConfigured}
                    onClick={() => void startWorld()}
                  >
                    {busy === 'World ID'
                      ? 'Opening verification…'
                      : accessPending
                        ? 'Retry Senior access'
                        : 'Verify with World ID'}
                  </button>
                ) : (
                  <p className="market-disclosure">
                    World ID verification is not configured on this deployment
                    yet.
                  </p>
                )}
                <p className="access-alternative">
                  No supported World ID credential, or prefer not to verify?
                </p>
                <button
                  className="text-link"
                  disabled={blocked}
                  onClick={onChooseJunior}
                >
                  Explore Junior with an invite <Icon name="arrow" size={12} />
                </button>
                <small className="market-disclosure">
                  Junior takes losses first. Switching layers changes your risk
                  exposure.
                </small>
              </>
            ) : (
              <form
                onSubmit={(event) => {
                  event.preventDefault()
                  if (code.trim())
                    void post(
                      '/api/whitelist',
                      { address, tranche: 'junior', code: code.trim() },
                      'Access'
                    )
                }}
              >
                <p>
                  Junior uses the team’s invite code. World ID is not required
                  for this first-loss layer.
                </p>
                <label htmlFor="invite-code">Junior invite code</label>
                <div className="invite-input">
                  <input
                    id="invite-code"
                    autoComplete="off"
                    placeholder="Team invite code"
                    value={code}
                    disabled={blocked}
                    onChange={(event) => setCode(event.target.value)}
                  />
                  <button
                    className="btn sm"
                    disabled={blocked || !code.trim() || !hubConfigured}
                  >
                    {busy === 'Access'
                      ? 'Requesting…'
                      : accessPending
                        ? 'Retry access'
                        : 'Get Junior access'}
                  </button>
                </div>
              </form>
            )}
          </div>
        )}
        {address && worldContext && (
          <WorldVerification
            context={worldContext}
            address={getAddress(address)}
            verify={(proof) =>
              post(
                '/api/whitelist',
                { address: getAddress(address), tranche: 'senior', proof },
                'Access'
              )
            }
            close={(completed) => {
              setWorldContext(null)
              if (!completed)
                setMsg({
                  ok: false,
                  text: 'Verification closed. Senior stays locked until access is confirmed. Retry or explore Junior.'
                })
            }}
          />
        )}
        {address && (
          <>
            <div className="funding-balances">
              <div>
                <span>Sepolia ETH</span>
                <strong>{fmt(funds.data?.gas, 18, 5)}</strong>
              </div>
              <div>
                <span>Test USDC</span>
                <strong>{fmt(funds.data?.usdc, 6, 2)}</strong>
              </div>
            </div>
            {!hasGas && (
              <div className="readiness-action">
                <p>
                  {eligible === true
                    ? 'Add testnet ETH for approvals and requests.'
                    : 'Gas support becomes available after access is approved.'}
                </p>
                <button
                  className="btn sm"
                  disabled={blocked || eligible !== true}
                  onClick={() =>
                    void post(
                      '/api/gas',
                      { address, chainId: PRODUCT.sepolia.chainId },
                      'Gas'
                    )
                  }
                >
                  {busy === 'Gas' ? 'Sending…' : 'Get test ETH'}
                </button>
              </div>
            )}
            {mode === 'invest' && (
              <div className="funding-note">
                <strong>Test USDC faucet</strong>
                <p>
                  Top up to 1,000 test USDC on Sepolia. The faucet pays its own
                  gas; your deposit still needs test ETH.
                </p>
                <button
                  className="btn sm"
                  disabled={
                    blocked ||
                    funds.isPending ||
                    funds.isError ||
                    (funds.data?.usdc ?? 0n) >= 1_000_000_000n
                  }
                  onClick={() => void post('/api/faucet', { address }, 'USDC')}
                >
                  {busy === 'USDC'
                    ? 'Funding…'
                    : (funds.data?.usdc ?? 0n) >= 1_000_000_000n
                      ? 'Test USDC funded'
                      : 'Get test USDC'}
                </button>
                <span className="mono" title={PRODUCT.sepolia.usdc}>
                  {short(PRODUCT.sepolia.usdc)}
                </span>
              </div>
            )}
            {mode === 'redeem' && !hasAssets && (
              <p className="market-disclosure">
                {shares === 0n
                  ? 'No shares available in this layer. Check for a claimable deposit above.'
                  : 'Share balance is being checked.'}
              </p>
            )}
            {funds.isError && (
              <p className="err">
                Could not refresh balances.{' '}
                <button
                  className="text-link"
                  disabled={blocked || funds.isFetching}
                  onClick={() => void funds.refetch()}
                >
                  Retry
                </button>
              </p>
            )}
            <p className="market-disclosure">
              Wallet prerequisites do not guarantee execution. Amount limits and
              gas costs are checked when submitting.
            </p>
          </>
        )}
        {msg && (
          <p role="status" className={msg.ok ? 'okmsg' : 'err'}>
            {msg.text}
          </p>
        )}
      </div>
    </details>
  )
}
