'use client'
import { useState } from 'react'
import { useAccount, useSwitchChain } from 'wagmi'
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
  disabled = false
}: {
  eligible: boolean | undefined
  type: 'Senior' | 'Junior'
  mode: 'invest' | 'redeem'
  shares?: bigint
  disabled?: boolean
}) {
  const { address, chainId } = useAccount()
  const { switchChainAsync } = useSwitchChain()
  const { open } = useAppKit()
  const qc = useQueryClient()
  const [code, setCode] = useState('')
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
  const blocked = disabled || !!busy
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
            ? 'Access granted on the hub. Vault permissions may take a moment to update.'
            : j?.skipped
              ? 'Your wallet already has testnet gas.'
              : 'Testnet gas sent to your wallet.'
      })
      void qc.invalidateQueries({ queryKey: ['account'] })
      void qc.invalidateQueries({ queryKey: ['funding'] })
    } catch (e) {
      setMsg({
        ok: false,
        text: e instanceof Error ? e.message : 'Could not complete the request.'
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
          <form
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
            <label htmlFor="invite-code">
              {type} access{' '}
              <small>
                {eligible == null
                  ? 'Awaiting permission data'
                  : 'Invite required'}
              </small>
            </label>
            <div className="invite-input">
              <input
                id="invite-code"
                autoComplete="off"
                placeholder="Team invite code"
                value={code}
                disabled={blocked}
                onChange={(e) => setCode(e.target.value)}
              />
              <button
                className="btn sm"
                disabled={blocked || !code.trim() || !hubConfigured}
              >
                {busy === 'Access' ? 'Requesting…' : 'Get access'}
              </button>
            </div>
          </form>
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
            {mode === 'invest' && !hasAssets && (
              <div className="funding-note">
                <strong>Need test USDC?</strong>
                <p>
                  Ask the team to fund this wallet with the strategy’s Sepolia
                  test token.
                </p>
                <span className="mono" title={PRODUCT.sepolia.usdc}>
                  {short(PRODUCT.sepolia.usdc)}
                </span>
                <button
                  className="text-link"
                  disabled={blocked}
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(PRODUCT.sepolia.usdc)
                      setMsg({
                        ok: true,
                        text: 'Test USDC contract address copied.'
                      })
                    } catch {
                      setMsg({
                        ok: false,
                        text: `Test USDC contract: ${PRODUCT.sepolia.usdc}`
                      })
                    }
                  }}
                >
                  Copy token address
                </button>
              </div>
            )}
            {mode === 'redeem' && !hasAssets && (
              <p className="market-disclosure">
                {shares === 0n
                  ? 'No shares available in this layer. Check for a claimable deposit below.'
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
