'use client'
import { useQuery } from '@tanstack/react-query'
import { useWalletAccount } from '@/hooks/wallet'
import type { Address } from 'viem'
import * as R from '@/lib/reads'
import { hubConfigured } from '@/lib/chains'
const POLL = 15_000

export const useProduct = () =>
  useQuery({
    queryKey: ['product'],
    enabled: hubConfigured,
    queryFn: R.loadProduct,
    staleTime: 60_000
  })
export function useOverview() {
  const { data: p } = useProduct()
  return useQuery({
    queryKey: ['overview', !!p],
    enabled: !!p,
    refetchInterval: POLL,
    queryFn: async () => {
      // A failing source RPC must not hide successfully loaded NAV or share prices.
      const [last, history, sources] = await Promise.allSettled([
        R.lastSettlement(p!),
        R.settlementHistory(p!, 400),
        R.yieldSources()
      ])
      const issues = [
        last.status === 'rejected' ? 'last' : '',
        history.status === 'rejected' ? 'history' : '',
        sources.status === 'rejected' ? 'sources' : ''
      ].filter(Boolean)
      return {
        last: last.status === 'fulfilled' ? last.value : null,
        history: history.status === 'fulfilled' ? history.value : [],
        sources: sources.status === 'fulfilled' ? sources.value : [],
        issues
      }
    }
  })
}
export const useBasket = () =>
  useQuery({
    queryKey: ['basket'],
    queryFn: R.basketHoldings,
    refetchInterval: 60_000
  })
export function useLp() {
  return useQuery({
    queryKey: ['lp'],
    queryFn: R.lpStats,
    refetchInterval: 30_000
  })
}
export function useAccountData() {
  const { address } = useWalletAccount()
  const { data: p } = useProduct()
  return useQuery({
    queryKey: ['account', address, !!p],
    enabled: !!p && !!address,
    refetchInterval: POLL,
    queryFn: () => R.accountSnapshot(p!, address!)
  })
}
export function useActivity(address?: Address) {
  return useQuery({
    queryKey: ['activity', address],
    enabled: hubConfigured && !!address,
    refetchInterval: POLL,
    queryFn: () => R.activity(address!)
  })
}
export function useReceives(address?: Address) {
  return useQuery({
    queryKey: ['receives', address],
    enabled: hubConfigured && !!address,
    refetchInterval: 60_000,
    queryFn: () => R.receiveHistory(address!)
  })
}
export function useSettlementProgress(round: number | null) {
  return useQuery({
    queryKey: ['settle', round],
    enabled: hubConfigured && !!round,
    refetchInterval: POLL,
    queryFn: () => R.settlementProgress(round!)
  })
}

export function useStockPriceHistory(
  history: R.Settlement[],
  enabled: boolean
) {
  const rounds = history
    .toSorted((a, b) => a.id - b.id)
    .slice(-60)
    .map(({ id, at }) => ({ id, at }))
  return useQuery({
    queryKey: ['stock-price-history', rounds.map((r) => r.id)],
    enabled: enabled && hubConfigured && rounds.length > 0,
    staleTime: 60_000,
    queryFn: () => R.stockPriceHistory(rounds)
  })
}
