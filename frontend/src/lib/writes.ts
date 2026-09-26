// The three spoke vault writes — deposit request, redeem request, claim. Each simulates first so custom errors decode by name.
import {
  BaseError,
  ContractFunctionRevertedError,
  type Address,
  type Hex,
  type WalletClient,
  type PublicClient
} from 'viem'
import { vaultAbi, erc20Abi } from './abi.ts'
import type { Tranche } from './reads'

export class ActionError extends Error {
  readonly code: string
  readonly cause?: unknown
  constructor(code: string, message: string, cause?: unknown) {
    super(message)
    this.code = code
    this.cause = cause
  }
}
export class PendingTransactionError extends ActionError {
  readonly hash: Hex
  readonly phase: 'approval' | 'transaction'
  constructor(hash: Hex, phase: 'approval' | 'transaction') {
    super(
      'CONFIRMATION_PENDING',
      'Transaction sent, but confirmation is not available yet. Check its status before submitting again.'
    )
    this.hash = hash
    this.phase = phase
  }
}
const MESSAGES: Record<string, string> = {
  NOT_WHITELISTED: 'This wallet is not eligible yet. Get whitelisted first.',
  OVER_CAPACITY: 'This deposit exceeds your personal cap.',
  BELOW_MIN: 'Amount is below the minimum request size.',
  BRIDGE_FEE:
    'This amount is too small for the bridge fee limit. Increase the amount and review the request again.',
  ZERO_AMOUNT: 'Enter an amount.',
  PAUSED: 'Deposits are paused right now.',
  NOTHING_CLAIMABLE: 'Nothing to claim yet. Wait for the next settlement.',
  INSUFFICIENT: 'Insufficient balance.',
  REJECTED: 'You rejected the transaction.',
  UNKNOWN: 'Transaction failed.'
}
export function toActionError(e: unknown): ActionError {
  if (e instanceof ActionError) return e
  const name =
    e instanceof BaseError
      ? e.walk((x) => x instanceof ContractFunctionRevertedError)
      : null
  const errName =
    name instanceof ContractFunctionRevertedError
      ? (name.data?.errorName ?? '')
      : ''
  const text = `${errName} ${(e as Error)?.message ?? ''}`
  const code = /DepositRestricted|NotAllowed|not whitelisted/i.test(text)
    ? 'NOT_WHITELISTED'
    : /insufficient amount for maxTxFee/i.test(text)
      ? 'BRIDGE_FEE'
      : /OverCapacity/.test(text)
        ? 'OVER_CAPACITY'
        : /BelowMinRequest/.test(text)
          ? 'BELOW_MIN'
          : /ZeroAmount/.test(text)
            ? 'ZERO_AMOUNT'
            : /EnforcedPause/.test(text)
              ? 'PAUSED'
              : /NothingClaimable|NotSettled|ClaimMismatch/.test(text)
                ? 'NOTHING_CLAIMABLE'
                : /insufficient|exceeds balance/i.test(text)
                  ? 'INSUFFICIENT'
                  : /rejected|denied/i.test(text)
                    ? 'REJECTED'
                    : 'UNKNOWN'
  return new ActionError(code, MESSAGES[code], e)
}

type Ctx = {
  wallet: WalletClient
  pub: PublicClient
  me: Address
  onProgress?: (message: string) => void
  onSubmitted?: (hash: Hex, phase: 'approval' | 'transaction') => void
}

async function checkWallet({ wallet, pub, me }: Ctx) {
  const [accounts, chainId] = await Promise.all([
    wallet.getAddresses(),
    wallet.getChainId()
  ])
  if (
    accounts[0]?.toLowerCase() !== me.toLowerCase() ||
    chainId !== pub.chain?.id
  )
    throw new ActionError(
      'ACCOUNT_CHANGED',
      'Wallet account or network changed. Review your request again.'
    )
}

/** A cancelled/replaced transaction is not a successful request, even if its replacement mined. */
export async function confirmTransaction(
  pub: PublicClient,
  hash: Hex,
  phase: 'approval' | 'transaction'
) {
  let replaced = false
  let receipt
  try {
    receipt = await pub.waitForTransactionReceipt({
      hash,
      timeout: 60_000,
      onReplaced: ({ reason }) => {
        if (reason !== 'repriced') replaced = true
      }
    })
  } catch {
    throw new PendingTransactionError(hash, phase)
  }
  if (replaced)
    throw new ActionError(
      'REPLACED',
      'The transaction was cancelled or replaced. Check your wallet and review the request again.'
    )
  if (receipt.status !== 'success')
    throw new ActionError(
      'REVERTED',
      phase === 'approval'
        ? 'Token approval reverted. No request was submitted.'
        : 'The transaction reverted. Refresh your balance before retrying.'
    )
  return receipt.transactionHash
}

async function ensureAllowance(
  ctx: Ctx,
  token: Address,
  spender: Address,
  amount: bigint
) {
  const { wallet, pub, me, onProgress } = ctx
  const cur = await pub.readContract({
    address: token,
    abi: erc20Abi,
    functionName: 'allowance',
    args: [me, spender]
  })
  if (cur >= amount) return
  await checkWallet(ctx)
  onProgress?.('Approve token access in your wallet…')
  const hash = await wallet.writeContract({
    address: token,
    abi: erc20Abi,
    functionName: 'approve',
    args: [spender, amount],
    account: me,
    chain: wallet.chain
  })
  ctx.onSubmitted?.(hash, 'approval')
  onProgress?.('Waiting for approval confirmation…')
  await confirmTransaction(pub, hash, 'approval')
  // A public node can still return the stale allowance right after the receipt — poll briefly until it updates.
  for (let i = 0; i < 12; i++) {
    if (
      (await pub.readContract({
        address: token,
        abi: erc20Abi,
        functionName: 'allowance',
        args: [me, spender]
      })) >= amount
    )
      return
    await new Promise((r) => setTimeout(r, 300))
  }
  throw new ActionError(
    'UNKNOWN',
    'Approval is not visible on the network yet. Please try again.'
  )
}

async function send(
  ctx: Ctx,
  fn: 'requestDeposit' | 'requestRedeem' | 'deposit' | 'redeem',
  vault: Address,
  args: readonly unknown[]
): Promise<Hex> {
  try {
    ctx.onProgress?.('Checking your request…')
    const { request } = await ctx.pub.simulateContract({
      address: vault,
      abi: vaultAbi,
      functionName: fn,
      args: args as never,
      account: ctx.me
    })
    ctx.onProgress?.('Confirm the transaction in your wallet…')
    await checkWallet(ctx)
    const hash = await ctx.wallet.writeContract({
      ...request,
      account: ctx.me,
      chain: ctx.wallet.chain
    })
    ctx.onSubmitted?.(hash, 'transaction')
    ctx.onProgress?.('Waiting for transaction confirmation…')
    return await confirmTransaction(ctx.pub, hash, 'transaction')
  } catch (e) {
    throw toActionError(e)
  }
}

export async function deposit(
  ctx: Ctx,
  t: Tranche,
  assets: bigint
): Promise<Hex> {
  if (assets <= 0n) throw new ActionError('ZERO_AMOUNT', MESSAGES.ZERO_AMOUNT)
  const bal = await ctx.pub.readContract({
    address: t.asset,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [ctx.me]
  })
  if (bal < assets) throw new ActionError('INSUFFICIENT', MESSAGES.INSUFFICIENT)
  await ensureAllowance(ctx, t.asset, t.vault, assets).catch((e) => {
    throw toActionError(e)
  })
  return send(ctx, 'requestDeposit', t.vault, [assets, ctx.me, ctx.me])
}
export async function redeem(
  ctx: Ctx,
  t: Tranche,
  shares: bigint
): Promise<Hex> {
  if (shares <= 0n) throw new ActionError('ZERO_AMOUNT', MESSAGES.ZERO_AMOUNT)
  const bal = await ctx.pub.readContract({
    address: t.share,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [ctx.me]
  })
  if (bal < shares) throw new ActionError('INSUFFICIENT', MESSAGES.INSUFFICIENT)
  await ensureAllowance(ctx, t.share, t.vault, shares).catch((e) => {
    throw toActionError(e)
  })
  return send(ctx, 'requestRedeem', t.vault, [shares, ctx.me, ctx.me])
}
/** Claims are all-or-nothing — a partial claim reverts with ClaimMismatch. */
export async function claim(
  ctx: Ctx,
  t: Tranche,
  kind: 'deposit' | 'redeem'
): Promise<Hex> {
  const fn =
    kind === 'deposit' ? 'claimableDepositRequest' : 'claimableRedeemRequest'
  const amt = await ctx.pub.readContract({
    address: t.vault,
    abi: vaultAbi,
    functionName: fn,
    args: [0n, ctx.me]
  })
  if (amt === 0n)
    throw new ActionError('NOTHING_CLAIMABLE', MESSAGES.NOTHING_CLAIMABLE)
  return kind === 'deposit'
    ? send(ctx, 'deposit', t.vault, [amt, ctx.me])
    : send(ctx, 'redeem', t.vault, [amt, ctx.me, ctx.me])
}
