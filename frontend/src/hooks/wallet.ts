'use client'
import { useSyncExternalStore } from 'react'
import { useAccount } from 'wagmi'

const subscribe = () => () => {}
const clientSnapshot = () => true
const serverSnapshot = () => false

/** A persisted connection can disappear while injected wallets are rediscovered on reload. */
export function useWalletAccount() {
  const account = useAccount()
  const hydrated = useSyncExternalStore(
    subscribe,
    clientSnapshot,
    serverSnapshot
  )
  return {
    address: hydrated ? account.address : undefined,
    chainId: hydrated ? account.chainId : undefined,
    isConnected: hydrated && account.isConnected
  }
}
