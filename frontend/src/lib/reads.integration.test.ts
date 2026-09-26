import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { BaseError, ContractFunctionRevertedError } from 'viem'
import * as abi from './abi.ts'
import { readIndependently } from './partial-reads.ts'
import type * as Reads from './reads'

const address = `0x${'1'.repeat(40)}` as const
function fixture(
  options: {
    sourceOffline?: boolean
    grant?: boolean
    restriction?: number
    permissionOffline?: boolean
    mixedRequests?: boolean
  } = {}
) {
  const calls: { chain: number; functionName: string }[] = []
  const readContract =
    (chain: number) =>
    async ({ functionName }: { functionName: string }) => {
      calls.push({ chain, functionName })
      if (chain === 46630 && options.sourceOffline)
        throw new Error('Source RPC unavailable')
      if (functionName === 'get_product')
        return [address, address, 0n, 600n, 0n]
      if (functionName === 'get_tranches')
        return [46630, 11155111].map((chain_id) => ({
          tranche_type: 1,
          apr: 0n,
          vault: { chain_id, vault_address: address },
          asset: address,
          shares: address
        }))
      if (functionName === 'get_multichain_adapters')
        return [{ chain_id: 11155111n, weightBps: 5000 }]
      if (functionName === 'get_investor_active_requests') return []
      if (functionName === 'decimals') return 6
      if (functionName === 'is_tranche_investor') {
        if (options.permissionOffline)
          throw new Error('Permission read unavailable')
        return options.grant ?? true
      }
      if (functionName === 'detectTransferRestriction')
        return options.restriction ?? 0
      if (options.mixedRequests && functionName === 'pendingDepositRequest')
        return 1n
      if (options.mixedRequests && functionName === 'claimableDepositRequest')
        return 2n
      return 0n
    }
  const exports: Record<string, unknown> = {}
  const dependencies: Record<string, unknown> = {
    './chains': {
      hub: { id: 49088 },
      hubClient: () => ({ readContract: readContract(49088) }),
      client: (chain: number) => ({ readContract: readContract(chain) })
    },
    viem: { BaseError, ContractFunctionRevertedError },
    './abi': abi,
    './product': { PRODUCT: { id: 1n, entryChains: [11155111] } },
    './partial-reads': { readIndependently },
    './math': {}
  }
  const code = ts.transpileModule(
    readFileSync(new URL('./reads.ts', import.meta.url), 'utf8'),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022
      }
    }
  ).outputText
  runInNewContext(code, {
    exports,
    process: { env: {} },
    require: (id: string) => {
      if (!(id in dependencies)) throw new Error(`Unexpected dependency: ${id}`)
      return dependencies[id]
    }
  })
  return { reads: exports as unknown as typeof Reads, calls }
}

test('source RPC outage still loads the entry product and keeps its balances and positions', async () => {
  const { reads, calls } = fixture({ sourceOffline: true })
  const product = await reads.loadProduct()
  assert.equal(product.decimals, 6)
  assert.ok(
    !calls.some((c) => c.chain === 46630 && c.functionName === 'decimals')
  )
  const account = await reads.accountSnapshot(product, address)
  assert.equal(account.positions.length, 1)
  assert.equal(account.positions[0].index, 1)
  assert.equal(account.positions[0].shares, 0n)
  assert.equal(account.balances[11155111], 0n)
  assert.equal(account.balances[46630], undefined)
  assert.equal(account.eligibility[1], true)
  assert.equal(account.eligibility[0], undefined)
  assert.deepEqual(account.issues.positions, [0])
})

test('deposit access requires both the Hub grant and propagated share-token permission', async () => {
  for (const [grant, restriction, expected] of [
    [true, 1, false],
    [false, 0, false],
    [true, 0, true]
  ] as const) {
    const { reads } = fixture({ grant, restriction })
    const product = await reads.loadProduct()
    assert.equal(await reads.canDeposit(product, address, 1), expected)
  }
})

test('unavailable permission leaves confirmed balances and claims readable', async () => {
  const { reads } = fixture({ permissionOffline: true })
  const account = await reads.accountSnapshot(
    await reads.loadProduct(),
    address
  )
  assert.equal(account.positions.length, 2)
  assert.equal(account.balances[11155111], 0n)
  assert.equal(account.eligibility[1], undefined)
  assert.deepEqual(account.issues.permissions, [0, 1])
})

test('a claimable older request cannot label a newer pending deposit ready to claim', async () => {
  const { reads } = fixture({ mixedRequests: true })
  const account = await reads.accountSnapshot(
    await reads.loadProduct(),
    address
  )
  assert.equal(account.positions[1].deposit.pending, 1n)
  assert.equal(account.positions[1].deposit.claimable, 2n)
  assert.equal(account.positions[1].deposit.stage, 'queued')
})
