'use client'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { MotionLink as Link } from '@/components/MotionLink'
import { formatUnits, type Hex } from 'viem'
import { useConfig, useSwitchChain } from 'wagmi'
import { useWalletAccount } from '@/hooks/wallet'
import { getWalletClient } from 'wagmi/actions'
import { useQueryClient } from '@tanstack/react-query'
import { useAppKit } from '@reown/appkit/react'
import type { Product, Settlement } from '@/lib/reads'
import {
  deposit,
  redeem,
  claim,
  toActionError,
  ActionError,
  PendingTransactionError,
  confirmTransaction
} from '@/lib/writes'
import { chainLabel, client, txUrl } from '@/lib/chains'
import { fmt, parseTokenAmount } from '@/lib/math'
import { useAccountData } from '@/hooks/data'
import { PRODUCT } from '@/lib/product'
import {
  parsePendingTransaction,
  type PendingTransaction
} from '@/lib/pending-transaction'
import { LoadingValue } from './Skeleton'
import { Icon } from './Icon'
import { Access } from './Access'
import { HelpTip } from './HelpTip'

type Mode = 'invest' | 'redeem'
type Context = Parameters<typeof deposit>[0]
const pendingKey = `achilles:pending:${PRODUCT.idHex}`
export function Ticket({
  product,
  compact = false,
  actionSlot,
  initialMode = 'invest',
  loading = false,
  last,
  type,
  onTypeChange,
  onBusyChange
}: {
  product?: Product
  compact?: boolean
  actionSlot?: HTMLDivElement | null
  initialMode?: Mode
  loading?: boolean
  last: Settlement | null
  type: 'Senior' | 'Junior'
  onTypeChange: (v: 'Senior' | 'Junior') => void
  onBusyChange: (busy: boolean) => void
}) {
  const { address, chainId: walletChain } = useWalletAccount()
  const config = useConfig()
  const { open } = useAppKit()
  const { switchChainAsync } = useSwitchChain()
  const qc = useQueryClient()
  const acct = useAccountData()
  const [mode, setMode] = useState<Mode>(initialMode)
  const [chain, setChain] = useState<number>(PRODUCT.entryChains[0])
  const [amt, setAmt] = useState('')
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<PendingTransaction | null>(null)
  useEffect(() => {
    const restore = () => {
      try {
        const saved = parsePendingTransaction(
          localStorage.getItem(pendingKey),
          PRODUCT.entryChains
        )
        setPending(saved)
        onBusyChange(!!saved)
      } catch {
        /* Storage may be disabled; current-session confirmation still works. */
      }
    }
    restore()
    const sync = (event: StorageEvent) => {
      if (event.key === pendingKey || event.key === null) restore()
    }
    window.addEventListener('storage', sync)
    return () => window.removeEventListener('storage', sync)
  }, [onBusyChange])
  function rememberPending(value: PendingTransaction | null) {
    setPending(value)
    try {
      if (value) localStorage.setItem(pendingKey, JSON.stringify(value))
      else localStorage.removeItem(pendingKey)
    } catch {
      /* Wallet confirmation does not depend on browser storage. */
    }
  }
  const locked = busy || !!pending
  const [reviewed, setReviewed] = useState<string | null>(null)
  const [stage, setStage] = useState('')
  const [msg, setMsg] = useState<{
    label?: string
    hash?: Hex
    chain?: number
    err?: string
  } | null>(null)
  const tranche = product?.tranches.find(
    (t) => t.type === type && t.chainId === chain
  )
  const pos = acct.data?.positions.find((p) => p.index === tranche?.index)
  const price = last && tranche ? last.sharePrices[tranche.index] : null
  const dec = product?.decimals ?? 6
  const raw = parseTokenAmount(amt, dec)
  const invalid = amt !== '' && raw == null
  const est =
    price && price > 0n && raw != null
      ? mode === 'invest'
        ? (raw * 10n ** 18n) / price
        : (raw * price) / 10n ** 18n
      : null
  const balance = mode === 'invest' ? acct.data?.balances[chain] : pos?.shares
  const eligible = tranche ? acct.data?.eligibility[tranche.index] : undefined
  const tooMuch = raw != null && balance != null && raw > balance
  const ready =
    !!tranche &&
    !!pos &&
    raw != null &&
    raw > 0n &&
    balance != null &&
    !tooMuch &&
    (mode !== 'invest' || eligible === true) &&
    !pending &&
    !acct.isError
  const networks = PRODUCT.entryChains
  const messageUrl = msg?.hash && msg.chain ? txUrl(msg.chain, msg.hash) : null
  const reviewKey = `${address}:${type}:${chain}:${mode}:${amt}`
  const reviewing = reviewed === reviewKey
  const reviewPanel = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!compact || !reviewing || !ready) return
    const panel = reviewPanel.current
    panel?.focus({ preventScroll: true })
    panel?.scrollIntoView({ block: 'end', behavior: 'instant' })
  }, [compact, reviewing, ready])

  function changeMode(value: Mode) {
    setMode(value)
    setAmt('')
    setMsg(null)
  }
  async function run(operation: (ctx: Context) => Promise<Hex>, label: string) {
    if (!address || !tranche || locked) return
    const me = address
    let waiting = false
    setBusy(true)
    onBusyChange(true)
    setMsg(null)
    setStage('Preparing transaction…')
    try {
      if (walletChain !== chain) {
        setStage('Switch network in your wallet…')
        await switchChainAsync({ chainId: chain })
      }
      // Re-acquire the client after switching; the hook's previous render can still reference the old chain.
      const wallet = await getWalletClient(config, { chainId: chain })
      if (
        wallet.account.address.toLowerCase() !== me.toLowerCase() ||
        (await wallet.getChainId()) !== chain
      )
        throw new ActionError(
          'ACCOUNT_CHANGED',
          'Wallet account or network changed. Please try again.'
        )
      const hash = await operation({
        wallet,
        pub: client(chain),
        me,
        onProgress: setStage,
        onSubmitted: (hash, phase) =>
          rememberPending({ hash, phase, chain, owner: me, label })
      })
      rememberPending(null)
      setMsg({ label: label + ' confirmed', hash, chain })
      setAmt('')
      await Promise.all(
        ['account', 'activity', 'receives', 'funding'].map((key) =>
          qc.invalidateQueries({ queryKey: [key] })
        )
      )
    } catch (e) {
      if (e instanceof PendingTransactionError) {
        waiting = true
        rememberPending({
          hash: e.hash,
          chain,
          owner: me,
          label,
          phase: e.phase
        })
      } else {
        rememberPending(null)
        setMsg({ err: toActionError(e).message })
      }
    } finally {
      setReviewed(null)
      setBusy(false)
      onBusyChange(waiting)
      setStage('')
    }
  }

  async function checkPending() {
    if (!pending || busy) return
    setBusy(true)
    let waiting = true
    try {
      const hash = await confirmTransaction(
        client(pending.chain),
        pending.hash,
        pending.phase
      )
      setMsg({
        label:
          pending.phase === 'approval'
            ? 'Approval confirmed. Review your request to continue'
            : `${pending.label} confirmed`,
        hash,
        chain: pending.chain
      })
      rememberPending(null)
      setAmt('')
      waiting = false
      await Promise.all(
        ['account', 'activity', 'receives', 'funding'].map((key) =>
          qc.invalidateQueries({ queryKey: [key] })
        )
      )
    } catch (error) {
      if (!(error instanceof PendingTransactionError)) {
        rememberPending(null)
        setMsg({ err: toActionError(error).message })
        waiting = false
      }
    } finally {
      setBusy(false)
      onBusyChange(waiting)
    }
  }

  const buttonText = busy
    ? stage
    : !product
      ? 'Waiting for network data'
      : !tranche
        ? 'Tranche unavailable'
        : acct.isError
          ? 'Account data unavailable'
          : eligible === false && mode === 'invest'
            ? 'Complete access to deposit'
            : balance == null || !pos || (mode === 'invest' && eligible == null)
              ? 'Checking your account…'
              : tooMuch
                ? 'Insufficient balance'
                : invalid
                  ? 'Check amount'
                  : !raw
                    ? 'Enter an amount'
                    : walletChain !== chain
                      ? 'Switch network to continue'
                      : mode === 'invest'
                        ? reviewing
                          ? 'Confirm deposit request'
                          : 'Review deposit'
                        : reviewing
                          ? 'Confirm redemption request'
                          : 'Review redemption'
  const primaryAction = (
    <div className="ticket-primary-action">
      {!address ? (
        <button className="btn primary full" onClick={() => open()}>
          <Icon name="wallet" size={16} />
          Connect wallet
        </button>
      ) : (
        <button
          className="btn primary full"
          aria-busy={busy}
          disabled={locked || !ready}
          onClick={() => {
            if (!reviewing) {
              setMsg(null)
              setReviewed(reviewKey)
            } else if (tranche && raw != null) {
              void run(
                (ctx) =>
                  mode === 'invest'
                    ? deposit(ctx, tranche, raw)
                    : redeem(ctx, tranche, raw),
                mode === 'invest' ? 'Deposit request' : 'Redemption request'
              )
            }
          }}
        >
          {busy && <span className="busy-spinner" aria-hidden="true" />}
          {buttonText}
          {ready && !busy && <Icon name="arrow" size={16} />}
        </button>
      )}
    </div>
  )
  return (
    <section
      className={`card ticket ${compact ? 'compact-ticket' : ''}`}
      id="invest"
      aria-label="Investment ticket"
    >
      <div className="ticket-header">
        <div className="ticket-heading">
          <h2>{compact ? 'Trade' : 'Your next move'}</h2>
          <Icon name="layers" size={18} />
        </div>
        <div className="seg" role="group" aria-label="Transaction type">
          <button
            aria-pressed={mode === 'invest'}
            disabled={locked}
            className={mode === 'invest' ? 'on' : ''}
            onClick={() => changeMode('invest')}
          >
            Deposit
          </button>
          <button
            aria-pressed={mode === 'redeem'}
            disabled={locked}
            className={mode === 'redeem' ? 'on' : ''}
            onClick={() => changeMode('redeem')}
          >
            Redeem
          </button>
        </div>
      </div>
      <div className="ticket-body">
        {pending && (
          <div className="claims-box" role="status">
            <h3>Confirmation pending</h3>
            <p className="sub">
              {pending.phase === 'approval' ? 'Token approval' : pending.label}{' '}
              was sent for {pending.owner.slice(0, 6)}…{pending.owner.slice(-4)}
              . Check confirmation before submitting another transaction.
            </p>
            <div className="row">
              {txUrl(pending.chain, pending.hash) && (
                <a
                  className="text-link"
                  target="_blank"
                  rel="noreferrer"
                  href={txUrl(pending.chain, pending.hash)!}
                >
                  View transaction
                </a>
              )}
              <button
                className="btn sm"
                disabled={busy}
                onClick={() => void checkPending()}
              >
                {busy ? 'Checking…' : 'Check confirmation'}
              </button>
            </div>
          </div>
        )}
        {pos &&
          tranche &&
          (pos.deposit.claimable > 0n || pos.redeem.claimable > 0n) && (
            <div className="claims-box">
              <h3>{type} · Ready to claim</h3>
              <p className="sub">{chainLabel(chain)} · Settled requests</p>
              {eligible !== true && pos.deposit.claimable > 0n && (
                <p className="sub">
                  Share claims can require active tranche access. If your claim
                  is blocked, check access below.
                </p>
              )}
              {pos.deposit.claimable > 0n && (
                <div className="claim-row">
                  <span>{fmt(pos.deposit.claimable, dec)} USDC deposited</span>
                  <button
                    className="btn sm"
                    disabled={locked}
                    onClick={() =>
                      run(
                        (ctx) => claim(ctx, tranche, 'deposit'),
                        'Share claim'
                      )
                    }
                  >
                    Claim shares
                  </button>
                </div>
              )}
              {pos.redeem.claimable > 0n && (
                <div className="claim-row">
                  <span>{fmt(pos.redeem.claimable, dec)} shares redeemed</span>
                  <button
                    className="btn sm"
                    disabled={locked}
                    onClick={() =>
                      run((ctx) => claim(ctx, tranche, 'redeem'), 'USDC claim')
                    }
                  >
                    Claim USDC
                  </button>
                </div>
              )}
            </div>
          )}
        <Access
          compact={compact}
          key={`${address ?? 'disconnected'}-${type}-${mode}`}
          onChooseJunior={() => {
            onTypeChange('Junior')
            setMsg(null)
          }}
          eligible={eligible}
          type={type}
          mode={mode}
          shares={pos?.shares}
          disabled={locked}
        />
        {!compact && (
          <>
            <div className="field-label">Choose your tranche</div>
            <div className="tranche-toggle" role="group" aria-label="Tranche">
              <button
                disabled={locked}
                aria-pressed={type === 'Senior'}
                className={type === 'Senior' ? 'on' : ''}
                onClick={() => {
                  onTypeChange('Senior')
                  setMsg(null)
                }}
              >
                <Icon name="shield" size={15} />
                Senior
              </button>
              <button
                disabled={locked}
                aria-pressed={type === 'Junior'}
                className={'junior' + (type === 'Junior' ? ' on' : '')}
                onClick={() => {
                  onTypeChange('Junior')
                  setMsg(null)
                }}
              >
                <Icon name="chart" size={15} />
                Junior
              </button>
            </div>
            <p className="tranche-description">
              {type === 'Senior'
                ? 'Priority yield. Junior capital absorbs losses before Senior.'
                : 'Residual yield. Junior capital takes losses before Senior.'}
            </p>
          </>
        )}
        {(!compact || networks.length > 1) && (
          <>
            <div className="field-label">
              <label htmlFor="deposit-network">Network</label>
            </div>
            <div className="network-select">
              <span className="network-coin">◇</span>
              <select
                id="deposit-network"
                value={chain}
                disabled={locked}
                onChange={(e) => {
                  setChain(Number(e.target.value))
                  setAmt('')
                  setMsg(null)
                }}
              >
                {networks.map((c) => (
                  <option key={c} value={c}>
                    {chainLabel(c)}
                  </option>
                ))}
              </select>
              <span className="pill">Testnet</span>
            </div>
          </>
        )}
        {compact && networks.length === 1 && (
          <div className="ticket-network-line">
            <span className="status-dot amber" />
            {chainLabel(chain)}
            <span>Testnet</span>
          </div>
        )}
        <div className="field-label">
          <label htmlFor="transaction-amount">
            {mode === 'invest' ? 'Deposit amount' : 'Shares to redeem'}
          </label>
        </div>
        <div className="amount-box">
          <div className="amount-row">
            <input
              id="transaction-amount"
              inputMode="decimal"
              autoComplete="off"
              placeholder="0.00"
              value={amt}
              disabled={locked}
              aria-invalid={invalid || tooMuch}
              aria-describedby="amount-help estimate-help"
              onChange={(e) => {
                setAmt(e.target.value)
                setMsg(null)
              }}
            />
            <span className="token-label">
              {mode === 'invest' && <span className="usdc-symbol">$</span>}
              {mode === 'invest' ? 'USDC' : 'shares'}
            </span>
          </div>
          <div className="amount-meta">
            <span>Balance: {address ? fmt(balance, dec, 4) : '—'}</span>
            <button
              className="max-button"
              disabled={locked || balance == null}
              onClick={() =>
                balance != null && setAmt(formatUnits(balance, dec))
              }
            >
              MAX
            </button>
          </div>
        </div>
        <div
          className="amount-presets"
          role="group"
          aria-label="Use a percentage of your balance"
        >
          {(compact ? [25, 50, 75] : [25, 50, 75, 100]).map((percent) => (
            <button
              key={percent}
              disabled={locked || balance == null}
              onClick={() => {
                if (balance != null) {
                  setAmt(formatUnits((balance * BigInt(percent)) / 100n, dec))
                  setMsg(null)
                }
              }}
            >
              {percent === 100 ? 'Max' : `${percent}%`}
            </button>
          ))}
        </div>
        <div id="amount-help">
          {invalid && (
            <p className="err">
              Enter a positive amount with up to {dec} decimal places.
            </p>
          )}
          {tooMuch && (
            <p className="err">This amount exceeds your available balance.</p>
          )}
        </div>
        <div className="estimate-row">
          <span>
            Estimated {mode === 'invest' ? 'shares' : 'USDC'}{' '}
            <HelpTip label="About the payout estimate">
              Based on the last settlement price. Your final amount is
              determined at settlement; a separate claim transaction is
              required.
            </HelpTip>
          </span>
          <strong>
            {fmt(est, dec, 4)} {mode === 'invest' ? 'shares' : 'USDC'}
          </strong>
        </div>
        <p className={compact ? 'sr-only' : 'estimate-note'} id="estimate-help">
          Based on the last settlement price. Final amounts are set at
          settlement.
        </p>
        <div className="ticket-quote">
          <span>Last share price</span>
          <strong>
            <LoadingValue loading={loading}>{fmt(price, 18, 6)}</LoadingValue>{' '}
            USDC
          </strong>
        </div>
        {reviewing && ready && (
          <div
            className="request-review"
            role="status"
            ref={reviewPanel}
            tabIndex={-1}
          >
            <strong>
              Review your {mode === 'invest' ? 'deposit' : 'redemption'}
            </strong>
            <p>
              {fmt(raw, dec, 4)} {mode === 'invest' ? 'USDC' : 'shares'} ·{' '}
              {type} · {chainLabel(chain)}
            </p>
            <p>
              {mode === 'invest'
                ? 'Your wallet may ask for token approval before the request.'
                : 'Your wallet may ask for share approval before the request.'}{' '}
              You will need to claim after settlement. The final amount may
              differ from the estimate.
            </p>
            <button
              className="text-link"
              onClick={() => setReviewed(null)}
              disabled={locked}
            >
              Edit request
            </button>
          </div>
        )}
        {compact && actionSlot
          ? createPortal(primaryAction, actionSlot)
          : primaryAction}
        {(acct.isError ||
          (acct.data &&
            tranche &&
            (acct.data.issues.positions.includes(tranche.index) ||
              acct.data.issues.permissions.includes(tranche.index) ||
              acct.data.issues.balances.includes(chain)))) &&
          address && (
            <button
              className="text-link"
              style={{ background: 'none', border: 0, marginTop: 10 }}
              disabled={locked || acct.isFetching}
              onClick={() => {
                void acct.refetch()
              }}
            >
              Retry account data
            </button>
          )}
        {pos && (pos.deposit.pending > 0n || pos.redeem.pending > 0n) && (
          <p className="pending-note">
            {pos.deposit.pending > 0n && (
              <>
                Deposit of {fmt(pos.deposit.pending, dec)} USDC is{' '}
                {STAGE[pos.deposit.stage ?? 'queued']}.{' '}
              </>
            )}
            {pos.redeem.pending > 0n && (
              <>
                Redemption of {fmt(pos.redeem.pending, dec)} shares is{' '}
                {STAGE[pos.redeem.stage ?? 'queued']}.
              </>
            )}
          </p>
        )}
        <div aria-live="polite" aria-atomic="true">
          {busy && <p className="sub">{stage}</p>}
          {msg?.label && (
            <p className="okmsg transaction-message">
              {msg.label}.{' '}
              {messageUrl && (
                <a href={messageUrl} target="_blank" rel="noreferrer">
                  View transaction <Icon name="external" size={11} />
                </a>
              )}
              <Link className="text-link" href="/activity">
                Track settlement <Icon name="arrow" size={12} />
              </Link>
            </p>
          )}
          {msg?.err && (
            <p className="err transaction-message" role="alert">
              {msg.err}
            </p>
          )}
        </div>
      </div>
      <div className="ticket-foot">
        <Icon name="clock" size={15} />
        <span>
          {mode === 'invest'
            ? 'Request → settlement → claim shares.'
            : 'Request → settlement → claim USDC.'}{' '}
          Funds are not available instantly.
        </span>
      </div>
    </section>
  )
}
const STAGE: Record<string, string> = {
  bridging: 'on its way to settlement',
  queued: 'waiting for the next settlement',
  settlement: 'being finalized',
  receivable: 'ready to claim'
}
