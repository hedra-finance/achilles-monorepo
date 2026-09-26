'use client'
import { useEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { getAddress } from 'viem'
import {
  accessPhase,
  accessResumeMessage,
  type AccessStatus
} from '@/lib/access-flow'
import { worldIdConfigured } from '@/lib/worldid'
import type { WorldContext } from './WorldVerification'
const WorldVerification = dynamic(() => import('./WorldVerification'), {
  ssr: false
})
import { useSignMessage, useSwitchChain } from 'wagmi'
import { useWalletAccount } from '@/hooks/wallet'
import { useAppKit } from '@reown/appkit/react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { client, hubConfigured } from '@/lib/chains'
import { PRODUCT } from '@/lib/product'
import { erc20Abi } from '@/lib/abi'
import { fmt, short } from '@/lib/math'
import { Icon } from './Icon'
import { HelpTip } from './HelpTip'

export function Access({
  eligible,
  compact = false,
  type,
  mode,
  shares,
  onChooseJunior,
  disabled = false
}: {
  eligible: boolean | undefined
  compact?: boolean
  type: 'Senior' | 'Junior'
  mode: 'invest' | 'redeem'
  shares?: bigint
  onChooseJunior: () => void
  disabled?: boolean
}) {
  const { address, chainId } = useWalletAccount()
  const { switchChainAsync } = useSwitchChain()
  const { signMessageAsync } = useSignMessage()
  const { open } = useAppKit()
  const qc = useQueryClient()
  const [code, setCode] = useState('')
  const [worldContext, setWorldContext] = useState<WorldContext | null>(null)
  const pendingKey = `achilles:access:${PRODUCT.idHex}:${address?.toLowerCase()}:${type}`
  const [pendingSince, setPendingSince] = useState<number | null>(null)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    try {
      const saved = Number(sessionStorage.getItem(pendingKey))
      if (saved > 0 && Date.now() - saved < 10 * 60_000) setPendingSince(saved)
    } catch {
      /* Storage can be disabled; on-chain status still recovers the flow. */
    }
    return () => {
      alive.current = false
    }
  }, [pendingKey])
  function rememberPending(value: number | null) {
    setPendingSince(value)
    try {
      if (value == null) sessionStorage.removeItem(pendingKey)
      else sessionStorage.setItem(pendingKey, String(value))
    } catch {
      /* No proofs or credentials are persisted. */
    }
  }
  const status = useQuery<AccessStatus>({
    queryKey: ['access-status', PRODUCT.idHex, address, type],
    enabled: !!address && mode === 'invest' && hubConfigured,
    staleTime: 0,
    refetchOnWindowFocus: true,
    retry: false,
    refetchInterval: pendingSince ? 3_000 : 15_000,
    queryFn: async ({ signal }) => {
      const response = await fetch(
        `/api/access-status?address=${address}&tranche=${type.toLowerCase()}`,
        {
          cache: 'no-store',
          signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)])
        }
      )
      if (!response.ok) throw new Error('Could not check access yet.')
      return response.json()
    }
  })
  const ready = eligible === true || status.data?.ready === true
  const phase = ready ? 'ready' : accessPhase(status.data, pendingSince != null)
  const accessPending = phase === 'syncing' || phase === 'checking'
  useEffect(() => {
    if (ready) {
      setPendingSince(null)
      setMsg(null)
      try {
        sessionStorage.removeItem(pendingKey)
      } catch {
        /* Optional storage. */
      }
      void qc.invalidateQueries({ queryKey: ['account', address] })
    }
  }, [ready, pendingKey, qc, address])
  useEffect(() => {
    if (pendingSince == null) return
    // After a minute, continue ordinary status polling without asking for another proof.
    const timer = setTimeout(
      () => {
        setPendingSince(null)
        try {
          sessionStorage.removeItem(pendingKey)
        } catch {
          /* Optional storage. */
        }
      },
      Math.max(0, 60_000 - (Date.now() - pendingSince))
    )
    return () => clearTimeout(timer)
  }, [pendingSince, pendingKey])
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
    ...(mode === 'invest' ? [{ name: 'Access', done: ready }] : []),
    { name: 'Gas', done: hasGas },
    { name: mode === 'invest' ? 'USDC' : 'Shares', done: hasAssets }
  ]
  const done = steps.filter((s) => s.done).length
  const blocked = disabled || !!busy || !!worldContext
  async function post(path: string, body: object, label: string) {
    setBusy(label)
    // Granting access writes to two chains and waits for the first receipt — tens of seconds of silence
    // otherwise. Say what is happening instead of clearing the panel and leaving it blank.
    setMsg(
      label === 'Access'
        ? {
            ok: true,
            text: 'Checking your verification and setting up access. This can take a moment.'
          }
        : null
    )
    try {
      const r = await fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(65_000)
      })
      const j = await r.json().catch(() => null)
      if (!alive.current) return false
      if (!r.ok)
        throw new Error(
          j?.error
            ? `${j.error}${j.code ? ` (${j.code})` : ''}`
            : 'The service is unavailable. Please try again.'
        )
      setMsg({
        ok: true,
        text:
          label === 'Access'
            ? j?.stage === 'REGISTRY_CONFIRMATION'
              ? 'World ID verified. Checking confirmation of your registration; no need to scan again while this is processing.'
              : j?.pending
                ? 'Access request submitted. Waiting for the permission to reach your vault.'
                : 'Access is registered. Checking your vault permission.'
            : j?.skipped
              ? `Your wallet already has enough ${label === 'USDC' ? 'test USDC' : 'testnet ETH'}.`
              : `${label === 'USDC' ? 'Test USDC' : 'Testnet ETH'} confirmed. Refreshing your balance.`
      })
      if (label === 'Access') {
        rememberPending(Date.now())
        void qc.invalidateQueries({
          queryKey: ['access-status', PRODUCT.idHex, address]
        })
      }
      void qc.invalidateQueries({ queryKey: ['account'] })
      void qc.invalidateQueries({ queryKey: ['funding'] })
      return true
    } catch (e) {
      if (!alive.current) return false
      if (label === 'Access') {
        void status.refetch()
        void qc.invalidateQueries({ queryKey: ['account', address] })
      }
      setMsg({
        ok: false,
        text: e instanceof Error ? e.message : 'Could not complete the request.'
      })
      return false
    } finally {
      if (alive.current) setBusy(null)
    }
  }
  async function resumeAccess() {
    setBusy('Signature')
    setMsg({
      ok: true,
      text: 'Your World ID is registered. Confirm this wallet to finish access setup; no new World ID scan is needed.'
    })
    try {
      const issuedAt = Date.now()
      const signature = await signMessageAsync({
        message: accessResumeMessage(
          window.location.origin,
          address!,
          PRODUCT.idHex,
          issuedAt
        )
      })
      if (!alive.current) return
      await post(
        '/api/whitelist',
        { address, tranche: 'senior', resume: true, issuedAt, signature },
        'Access'
      )
    } catch {
      if (alive.current)
        setMsg({
          ok: false,
          text: 'Wallet confirmation was not completed. Your World ID registration is saved; you can continue setup when ready.'
        })
    } finally {
      if (alive.current) setBusy(null)
    }
  }
  async function startWorld() {
    setBusy('World ID')
    setMsg(null)
    try {
      const response = await fetch('/api/worldid', {
        cache: 'no-store',
        signal: AbortSignal.timeout(15_000)
      })
      const data = await response.json().catch(() => null)
      if (!response.ok || !data?.rp_context)
        throw new Error(
          data?.error ?? 'Verification is temporarily unavailable.'
        )
      if (alive.current) setWorldContext(data)
    } catch (error) {
      if (!alive.current) return
      setMsg({
        ok: false,
        text:
          error instanceof Error
            ? error.message
            : 'Could not start verification.'
      })
    } finally {
      if (alive.current) setBusy(null)
    }
  }
  if (compact && !address)
    return (
      <p className="wallet-preflight-note">
        Connect to check your balance and {type} access.
      </p>
    )
  return (
    <details
      className="investment-access"
      open={compact ? undefined : done < steps.length}
    >
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
        {address && mode === 'invest' && !ready && (
          <div className="tranche-access">
            <div className="access-policy-title">
              <Icon name={type === 'Senior' ? 'shield' : 'layers'} size={17} />
              <strong>{type} access</strong>
            </div>
            {accessPending && (
              <p className="access-pending" role="status">
                <Icon name="clock" size={14} />
                {phase === 'syncing'
                  ? 'Verification complete. Your vault access is syncing automatically.'
                  : 'Checking your access request. You can stay on this page; no new verification is needed.'}
              </p>
            )}
            {(status.isError || accessPending || phase === 'resume') && (
              <p className="market-disclosure">
                {status.isError
                  ? 'The status check is delayed. We will check again automatically. '
                  : phase === 'resume'
                    ? 'World ID is registered. Only wallet access setup remains. '
                    : 'Access opens when the network confirms it. '}
                <button
                  className="text-link"
                  disabled={status.isFetching || !!busy}
                  onClick={() => {
                    void status.refetch()
                    void qc.invalidateQueries({
                      queryKey: ['account', address]
                    })
                  }}
                >
                  {status.isFetching ? 'Checking…' : 'Check status'}
                </button>
              </p>
            )}
            {type === 'Senior' ? (
              <>
                <p>
                  One human, one wallet.{' '}
                  <HelpTip label="About World ID access">
                    Achilles receives a verification proof, not your personal
                    identity details. This prevents duplicate registrations; it
                    is not KYC, investment eligibility, or a deposit cap.
                  </HelpTip>
                </p>
                {worldIdConfigured() ? (
                  <button
                    className="btn primary sm"
                    disabled={
                      blocked ||
                      !hubConfigured ||
                      accessPending ||
                      status.isPending ||
                      (status.isError && !status.data)
                    }
                    onClick={() =>
                      void (phase === 'resume' ? resumeAccess() : startWorld())
                    }
                  >
                    {busy === 'World ID'
                      ? 'Opening verification…'
                      : busy === 'Signature'
                        ? 'Confirm in your wallet…'
                        : busy === 'Access'
                          ? 'Setting up access…'
                          : accessPending
                            ? 'Syncing access…'
                            : status.isPending
                              ? 'Checking access…'
                              : status.isError && !status.data
                                ? 'Waiting for access status…'
                                : phase === 'resume'
                                  ? 'Complete access setup'
                                  : 'Verify with World ID'}
                  </button>
                ) : (
                  <p className="market-disclosure">
                    World ID verification is not configured on this deployment
                    yet.
                  </p>
                )}
                <p className="access-alternative">
                  Cancelled, no World App or supported v4 credential, or
                  verification unavailable?
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
                    disabled={
                      blocked || accessPending || !code.trim() || !hubConfigured
                    }
                  >
                    {busy === 'Access'
                      ? 'Requesting…'
                      : accessPending
                        ? 'Syncing access…'
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
            fail={(errorCode) =>
              setMsg((previous) =>
                previous?.ok === false
                  ? previous
                  : {
                      ok: false,
                      text: `World ID could not finish this request (${errorCode}). Close the window and start a fresh verification. Your existing registration, if any, is preserved.`
                    }
              )
            }
            close={(completed) => {
              setWorldContext(null)
              if (!completed && busy !== 'Access')
                setMsg((previous) =>
                  previous?.ok === false
                    ? previous
                    : {
                        ok: false,
                        text: 'Verification closed. Senior stays locked until access is confirmed. Retry or explore Junior.'
                      }
                )
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
        {msg ? (
          <p role="status" className={msg.ok ? 'okmsg' : 'err'}>
            {msg.text}
          </p>
        ) : ready && mode === 'invest' ? (
          <p role="status" className="okmsg">
            {type} access is ready. You can continue with your deposit.
          </p>
        ) : null}
      </div>
    </details>
  )
}
