'use client'
import { useQuery } from '@tanstack/react-query'
import { useAccount } from 'wagmi'
import type { Address } from 'viem'
import * as R from '@/lib/reads'

const POLL = 15_000

export const useProduct = () => useQuery({ queryKey: ['product'], queryFn: R.loadProduct, staleTime: Infinity })

export function useOverview() {
  const { data: p } = useProduct()
  return useQuery({
    queryKey: ['overview', !!p],
    enabled: !!p,
    refetchInterval: POLL,
    queryFn: async () => {
      const [last, history, sources] = await Promise.all([R.lastSettlement(p!), R.settlementHistory(p!, 400), R.yieldSources()])
      return { last, history, sources }
    },
  })
}
export const useBasket = () => useQuery({ queryKey: ['basket'], queryFn: R.basketHoldings, refetchInterval: 60_000 })
export function useLp() {
  const { data: p } = useProduct()
  return useQuery({ queryKey: ['lp', !!p], enabled: !!p, queryFn: () => R.lpStats(p!), refetchInterval: 30_000 })
}

/** Everything about one wallet — balances, eligibility, tranche state. Disabled when no wallet is connected. */
export function useAccountData() {
  const { address } = useAccount()
  const { data: p } = useProduct()
  return useQuery({
    queryKey: ['account', address, !!p],
    enabled: !!p && !!address,
    refetchInterval: POLL,
    queryFn: async () => {
      const [pos, eligible, balances] = await Promise.all([
        R.position(p!, address!), R.canDeposit(p!, address!), R.assetBalances(p!, address!),
      ])
      return { positions: pos, eligible, balances }
    },
  })
}
export function useActivity(address?: Address) {
  return useQuery({ queryKey: ['activity', address], enabled: !!address, refetchInterval: POLL, queryFn: () => R.activity(address!) })
}
export function useReceives(address?: Address) {
  return useQuery({ queryKey: ['receives', address], enabled: !!address, refetchInterval: 60_000, queryFn: () => R.receiveHistory(address!) })
}
export function useSettlementProgress(round: number | null) {
  return useQuery({ queryKey: ['settle', round], enabled: !!round, refetchInterval: POLL, queryFn: () => R.settlementProgress(round!) })
}
