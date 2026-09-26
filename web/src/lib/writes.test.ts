import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Address, Hex } from 'viem'
import {
  deposit,
  redeem,
  claim,
  confirmTransaction,
  PendingTransactionError,
  ActionError
} from './writes.ts'

const me = `0x${'1'.repeat(40)}` as Address
const other = `0x${'2'.repeat(40)}` as Address
const hash = `0x${'a'.repeat(64)}` as Hex
const replacementHash = `0x${'b'.repeat(64)}` as Hex
const tranche = {
  index: 0,
  type: 'Junior' as const,
  apr: 0n,
  chainId: 11155111,
  asset: other,
  vault: other,
  share: other
}

function fixture(
  options: {
    allowance?: bigint
    balance?: bigint
    timeout?: boolean
    status?: string
    replacement?: 'cancelled' | 'replaced' | 'repriced'
    switchAfterApproval?: boolean
    chain?: number
  } = {}
) {
  const state = {
    allowance: options.allowance ?? 0n,
    account: me,
    writes: [] as { functionName: string; args: unknown[] }[]
  }
  const ctx = {
    me,
    wallet: {
      chain: { id: 11155111 },
      getAddresses: async () => [state.account],
      getChainId: async () => options.chain ?? 11155111,
      writeContract: async (request: {
        functionName: string
        args: unknown[]
      }) => {
        state.writes.push(request)
        if (request.functionName === 'approve')
          state.allowance = request.args[1] as bigint
        return hash
      }
    },
    pub: {
      chain: { id: 11155111 },
      readContract: async ({ functionName }: { functionName: string }) =>
        functionName === 'allowance'
          ? state.allowance
          : (options.balance ?? 100n),
      simulateContract: async (request: object) => ({ request }),
      waitForTransactionReceipt: async ({
        onReplaced
      }: {
        onReplaced?: (value: unknown) => void
      }) => {
        if (options.timeout) throw new Error('confirmation timed out')
        if (options.replacement) onReplaced?.({ reason: options.replacement })
        if (options.switchAfterApproval) state.account = other
        return {
          status: options.status ?? 'success',
          transactionHash: options.replacement ? replacementHash : hash
        }
      }
    }
  } as unknown as Parameters<typeof deposit>[0]
  return { ctx, state }
}

test('deposit requests exact approval and submits only after successful approval', async () => {
  const { ctx, state } = fixture()
  assert.equal(await deposit(ctx, tranche, 25n), hash)
  assert.deepEqual(
    state.writes.map((w) => w.functionName),
    ['approve', 'requestDeposit']
  )
  assert.equal(state.writes[0].args[1], 25n)
  assert.deepEqual(state.writes[1].args, [25n, me, me])
})

test('failed approval cannot proceed to deposit', async () => {
  const { ctx, state } = fixture({ status: 'reverted' })
  await assert.rejects(
    deposit(ctx, tranche, 25n),
    (error: unknown) =>
      error instanceof ActionError && error.code === 'REVERTED'
  )
  assert.deepEqual(
    state.writes.map((w) => w.functionName),
    ['approve']
  )
})

test('switching the account after approval cannot submit the reviewed request', async () => {
  const { ctx, state } = fixture({ switchAfterApproval: true })
  await assert.rejects(
    deposit(ctx, tranche, 25n),
    (error: unknown) =>
      error instanceof ActionError && error.code === 'ACCOUNT_CHANGED'
  )
  assert.deepEqual(
    state.writes.map((w) => w.functionName),
    ['approve']
  )
})

test('wrong wallet chain and insufficient balance never sign', async () => {
  for (const options of [{ chain: 1 }, { balance: 2n }]) {
    const { ctx, state } = fixture(options)
    await assert.rejects(deposit(ctx, tranche, 25n))
    assert.equal(state.writes.length, 0)
  }
})

test('confirmation timeout preserves hash and phase without resubmitting', async () => {
  for (const allowance of [0n, 100n]) {
    const { ctx, state } = fixture({ timeout: true, allowance })
    await assert.rejects(
      deposit(ctx, tranche, 25n),
      (error: unknown) =>
        error instanceof PendingTransactionError &&
        error.hash === hash &&
        error.phase === (allowance ? 'transaction' : 'approval')
    )
    assert.equal(state.writes.length, 1)
  }
})

test('broadcast metadata is reported before receipt confirmation can time out', async () => {
  const { ctx } = fixture({ timeout: true, allowance: 100n })
  const submitted: unknown[] = []
  ctx.onSubmitted = (hash, phase) => submitted.push({ hash, phase })
  await assert.rejects(deposit(ctx, tranche, 25n), PendingTransactionError)
  assert.deepEqual(submitted, [{ hash, phase: 'transaction' }])
})

test('cancelled or different replacement is not a success; repricing returns the mined hash', async () => {
  for (const replacement of ['cancelled', 'replaced'] as const) {
    const { ctx } = fixture({ replacement })
    await assert.rejects(
      confirmTransaction(ctx.pub, hash, 'transaction'),
      (error: unknown) =>
        error instanceof ActionError && error.code === 'REPLACED'
    )
  }
  const { ctx } = fixture({ replacement: 'repriced' })
  assert.equal(
    await confirmTransaction(ctx.pub, hash, 'transaction'),
    replacementHash
  )
})

test('redeem uses shares and claims use the full current claimable amount', async () => {
  const { ctx, state } = fixture({ allowance: 100n })
  await redeem(ctx, tranche, 20n)
  await claim(ctx, tranche, 'deposit')
  await claim(ctx, tranche, 'redeem')
  assert.deepEqual(
    state.writes.map((w) => [w.functionName, w.args[0]]),
    [
      ['requestRedeem', 20n],
      ['deposit', 100n],
      ['redeem', 100n]
    ]
  )
  const empty = fixture({ balance: 0n })
  await assert.rejects(
    claim(empty.ctx, tranche, 'deposit'),
    (error: unknown) =>
      error instanceof ActionError && error.code === 'NOTHING_CLAIMABLE'
  )
  assert.equal(empty.state.writes.length, 0)
})
