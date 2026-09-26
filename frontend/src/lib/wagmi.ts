import { cookieStorage, createStorage, fallback, http } from 'wagmi'
import { WagmiAdapter } from '@reown/appkit-adapter-wagmi'
import { walletChains } from './chains'

export const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? ''

/**
 * Wallet adapter — Sepolia only, the one network a user signs on.
 *
 * The transports name our endpoints explicitly. http() with no argument lets the adapter fall back to
 * WalletConnect's own RPC, which does not serve these testnets on a free plan: a send then fails with
 * "chain is not available on free plan" from a URL nobody configured.
 */
export const wagmiAdapter = new WagmiAdapter({
  projectId: projectId || '00000000000000000000000000000000', // a dummy id — AppKit refuses to initialize with an empty one; browser-extension wallets still show up
  networks: [...walletChains],
  // Same endpoints and the same fallback as the read clients: a wallet send should not fail because
  // one public RPC is having a slow minute.
  transports: Object.fromEntries(
    walletChains.map((c) => [
      c.id,
      fallback(c.rpcUrls.default.http.map((u) => http(u, { timeout: 10_000 })), { rank: false }),
    ]),
  ),
  storage: createStorage({ storage: cookieStorage }),
  ssr: true,
})
export const wagmiConfig = wagmiAdapter.wagmiConfig
