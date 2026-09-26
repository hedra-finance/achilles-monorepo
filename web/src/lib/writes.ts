// The three spoke vault writes — deposit request, redeem request, claim. Each simulates first so custom errors decode by name.
import {
  BaseError,
  ContractFunctionRevertedError,
  type Address,
  type Hex,
  type WalletClient,
  type PublicClient
} from 'viem'
import { vaultAbi, erc20Abi } from './abi'
import type { Tranche } from './reads'

export class ActionError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly cause?: unknown
  ) {
    super(message)
  }
}
const MESSAGES: Record<string, string> = {
  NOT_WHITELISTED: 'This wallet is not eligible yet. Get whitelisted first.',
  OVER_CAPACITY: 'This deposit exceeds your personal cap.',
  BELOW_MIN: 'Amount is below the minimum request size.',
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
}

async function ensureAllowance(
  { wallet, pub, me, onProgress }: Ctx,
  token: Address,
  spender: Address,
  amount: bigint
) {
  const cur = await pub.readContract({
    address: token,
    abi: erc20Abi,
    functionName: 'allowance',
    args: [me, spender]
  })
  if (cur >= amount) return
  onProgress?.('Approve token access in your wallet…')
  const hash = await wallet.writeContract({
    address: token,
    abi: erc20Abi,
    functionName: 'approve',
    args: [spender, amount],
    account: me,
    chain: wallet.chain
  })
  onProgress?.('Waiting for approval confirmation…')
  const receipt = await pub.waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success')
    throw new ActionError('UNKNOWN', 'Token approval failed. Please try again.')
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
    const hash = await ctx.wallet.writeContract({
      ...request,
      account: ctx.me,
      chain: ctx.wallet.chain
    })
    ctx.onProgress?.('Waiting for transaction confirmation…')
    const rc = await ctx.pub.waitForTransactionReceipt({ hash })
    if (rc.status !== 'success')
      throw new ActionError('UNKNOWN', MESSAGES.UNKNOWN)
    return hash
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
