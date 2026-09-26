'use client'
import { useState, type ReactNode } from 'react'
import { installDevLog, queryLogHandlers } from '@/lib/devlog'
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { WagmiProvider, cookieToInitialState } from 'wagmi'
import { createAppKit } from '@reown/appkit/react'
import { wagmiAdapter, wagmiConfig, projectId } from '@/lib/wagmi'
import { walletChains } from '@/lib/chains'

createAppKit({
  adapters: [wagmiAdapter],
  projectId: projectId || '00000000000000000000000000000000',
  networks: [walletChains[0], ...walletChains.slice(1)],
  metadata: {
    name: 'Achilles',
    description: 'Cross-chain tranche vaults',
    url:
      typeof window === 'undefined'
        ? 'http://localhost:3000'
        : window.location.origin,
    icons: [
      typeof window === 'undefined'
        ? '/brand/achilles.png'
        : window.location.origin + '/brand/achilles.png'
    ]
  },
  features: { analytics: false, email: false, socials: false },
  themeMode: 'dark',
  enableWalletConnect: Boolean(projectId)
})

export function Providers({
  children,
  cookies
}: {
  children: ReactNode
  cookies: string | null
}) {
  // retry: 0 — a retried query never settles in this app (fetchStatus gets stuck at 'paused' forever, even though
  // navigator.onLine is true; most likely AppKit's failed remote-config fetch, without a real WalletConnect project
  // id, flips TanStack Query's shared onlineManager offline and the retry backoff then waits for an 'online' event
  // that never comes). Until that's root-caused, don't retry — fail fast and let each hook's refetchInterval poll again.
  const [qc] = useState(
    () =>
      (() => {
        installDevLog()
        // A failed read becomes a UI state and the reason is otherwise lost; the caches are the one
        // place every query and mutation failure passes through. No-ops in production.
        const log = queryLogHandlers()
        return new QueryClient({
          queryCache: new QueryCache({ onError: (e, q) => log.onQueryError(q.queryKey, e) }),
          mutationCache: new MutationCache({ onError: (e) => log.onMutationError(e) }),
          defaultOptions: {
            queries: { staleTime: 10_000, refetchOnWindowFocus: false, retry: 0 }
          }
        })
      })()
  )
  return (
    <WagmiProvider
      config={wagmiConfig}
      initialState={cookieToInitialState(wagmiConfig, cookies)}
    >
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    </WagmiProvider>
  )
}
