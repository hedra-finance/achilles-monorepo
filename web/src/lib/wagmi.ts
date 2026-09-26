import { cookieStorage, createStorage, http } from 'wagmi'
import { WagmiAdapter } from '@reown/appkit-adapter-wagmi'
import { spokeChains } from './chains'

export const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? ''

/** Wallet adapter — the two spoke chains only. RPC endpoints come from the chain definitions' public URLs. */
export const wagmiAdapter = new WagmiAdapter({
  projectId: projectId || '00000000000000000000000000000000', // a dummy id — AppKit refuses to initialize with an empty one; browser-extension wallets still show up
  networks: [...spokeChains],
  transports: Object.fromEntries(spokeChains.map((c) => [c.id, http()])),
  storage: createStorage({ storage: cookieStorage }),
  ssr: true,
})
export const wagmiConfig = wagmiAdapter.wagmiConfig
