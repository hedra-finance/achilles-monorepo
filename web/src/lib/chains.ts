import { createPublicClient, http, defineChain, type PublicClient } from 'viem'
import { sepolia } from 'viem/chains'

// Hub: the settlement chain. The tranche precompiles (0x200-0x204) only exist here. Read-only — no wallet connects to it.
export const hubConfigured = Boolean(process.env.NEXT_PUBLIC_HUB_RPC?.trim())
export const hub = defineChain({
  id: 49088,
  name: 'Settlement Hub',
  nativeCurrency: { name: 'Hub Token', symbol: 'HUB', decimals: 18 },
  rpcUrls: { default: { http: [process.env.NEXT_PUBLIC_HUB_RPC ?? ''] } }
})

export const robinhood = defineChain({
  id: 46630,
  name: 'Robinhood Testnet',
  nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: {
      http: [
        process.env.NEXT_PUBLIC_ROBINHOOD_RPC ??
          'https://rpc.testnet.chain.robinhood.com'
      ]
    }
  },
  blockExplorers: {
    default: {
      name: 'Explorer',
      url: 'https://explorer.testnet.chain.robinhood.com'
    }
  }
})

export const sepoliaChain = defineChain({
  ...sepolia,
  rpcUrls: {
    default: {
      http: [
        process.env.NEXT_PUBLIC_SEPOLIA_RPC ??
          'https://ethereum-sepolia-rpc.publicnode.com'
      ]
    }
  }
})

/** Chains a wallet connects to = the two spokes that hold vaults. The hub is excluded. */
export const spokeChains = [sepoliaChain, robinhood] as const
export const chainById: Record<
  number,
  typeof hub | typeof robinhood | typeof sepoliaChain
> = {
  [hub.id]: hub,
  [robinhood.id]: robinhood,
  [sepoliaChain.id]: sepoliaChain
}
export const chainLabel = (id: number) => chainById[id]?.name ?? `chain ${id}`
export const txUrl = (chainId: number, hash: string) => {
  const c = chainById[chainId]
  return c?.blockExplorers?.default
    ? `${c.blockExplorers.default.url}/tx/${hash}`
    : null
}
export const addressUrl = (chainId: number, address: string) => {
  const explorer = chainById[chainId]?.blockExplorers?.default
  return explorer ? `${explorer.url}/address/${address}` : null
}

const clients = new Map<number, PublicClient>()
/** Per-chain read client. The hub has no Multicall3, so it falls back to HTTP batching; batch size is capped at 50. */
export function client(chainId: number): PublicClient {
  if (chainId === hub.id && !hubConfigured)
    throw new Error('Settlement network connection is not configured.')
  let c = clients.get(chainId)
  if (!c) {
    const chain = chainById[chainId]
    if (!chain) throw new Error(`unknown chain ${chainId}`)
    c = createPublicClient({
      chain,
      batch: chainId === hub.id ? undefined : { multicall: true },
      transport: http(undefined, { batch: { batchSize: 50, wait: 16 } })
    })
    clients.set(chainId, c)
  }
  return c
}
export const hubClient = () => client(hub.id)
