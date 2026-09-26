'use client'
import { useOverview, useProduct } from './data'
import { juniorDisplayYield } from '@/lib/junior-display'
import { PRODUCT } from '@/lib/product'
import { hubConfigured } from '@/lib/chains'
import { displayYieldPercent } from '@/lib/math'

export function useStrategySnapshot() {
  const product = useProduct()
  const overview = useOverview()
  const p = product.data
  const sr =
    p?.tranches.findIndex(
      (t) => t.type === 'Senior' && t.chainId === PRODUCT.entryChains[0]
    ) ?? -1
  const jr =
    p?.tranches.findIndex(
      (t) => t.type === 'Junior' && t.chainId === PRODUCT.entryChains[0]
    ) ?? -1
  const history = overview.data?.history ?? []
  const junior = displayYieldPercent(
    history.map((h) => ({
      at: h.at,
      price: h.sharePrices[jr] == null ? null : Number(h.sharePrices[jr]) / 1e18
    }))
  )
  return {
    last: overview.data?.last,
    decimals: p?.decimals ?? 6,
    seniorApr: p && sr >= 0 ? Number(p.tranches[sr].apr) / 1e16 : null,
    junior: juniorDisplayYield(junior),
    seniorPrice: overview.data?.last?.sharePrices[sr],
    issue:
      !hubConfigured ||
      product.isError ||
      overview.isError ||
      !!overview.data?.issues.length,
    loading: hubConfigured && (product.isPending || (!!p && overview.isPending))
  }
}
