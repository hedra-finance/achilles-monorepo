import { createPublicClient, fallback, http, defineChain, type PublicClient } from 'viem'
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

// More than one endpoint on purpose. Public Sepolia RPCs go slow or start timing out without notice,
// and a single one takes the whole page with it. These three were checked to serve both eth_call and
// eth_getLogs; the configured endpoint, when set, is tried first.
const SEPOLIA_RPCS = [
  process.env.NEXT_PUBLIC_SEPOLIA_RPC,
  'https://ethereum-sepolia-rpc.publicnode.com',
  'https://rpc.sepolia.ethpandaops.io',
  'https://sepolia.gateway.tenderly.co'
].filter((u): u is string => Boolean(u && u.trim()))

export const sepoliaChain = defineChain({
  ...sepolia,
  rpcUrls: { default: { http: [...new Set(SEPOLIA_RPCS)] } }
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
    // Every endpoint the chain declares, in order, so one slow host degrades rather than breaks. A
    // 10s ceiling keeps a stalled request from holding the UI: viem moves to the next endpoint instead.
    const opts = { batch: { batchSize: 50, wait: 16 }, timeout: 10_000 } as const
    const urls = chain.rpcUrls.default.http
    c = createPublicClient({
      chain,
      batch: chainId === hub.id ? undefined : { multicall: true },
      transport:
        urls.length > 1
          ? fallback(urls.map((u) => http(u, opts)), { rank: false })
          : http(urls[0], opts)
    })
    clients.set(chainId, c)
  }
  return c
}
export const hubClient = () => client(hub.id)
