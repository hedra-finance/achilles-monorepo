export type WeightedItem = {
  id: string
  label: string
  value: bigint | null
  color: string
  ticker?: string
  chainId?: number
}

/** Never normalize a partial or zero-total portfolio into a misleading full circle. */
export function distribution(items: WeightedItem[]) {
  if (
    !items.length ||
    items.some((item) => item.value == null || item.value < 0n)
  )
    return null
  const total = items.reduce((sum, item) => sum + item.value!, 0n)
  if (total === 0n) return { total, slices: [] }
  return {
    total,
    slices: items.map((item) => ({
      ...item,
      percent: Number((item.value! * 100_000_000n) / total) / 1_000_000
    }))
  }
}

export type StockPricePoint = {
  round: number
  at: Date | null
  prices: Record<string, bigint>
  unavailable?: boolean
  missingRecord?: boolean
}
/** Use one common baseline round for comparison; a missing or zero baseline is not indexable. */
export function indexStockPrices(
  points: StockPricePoint[],
  assets: { token: string; ticker: string; color: string }[]
) {
  const ordered = points.toSorted((a, b) => a.round - b.round)
  const baseline = ordered.find((p) =>
    Object.values(p.prices).some((price) => price > 0n)
  )
  const visible = baseline
    ? ordered.filter((p) => p.round >= baseline.round)
    : []
  return {
    baseline: baseline?.round ?? null,
    points: visible,
    series: assets.map((asset) => {
      const token = asset.token.toLowerCase()
      const base = baseline?.prices[token]
      return {
        ...asset,
        values: visible.map((p) => {
          const price = p.prices[token]
          return base != null && base > 0n && price != null
            ? Number((price * 100_000_000n) / base) / 1_000_000
            : null
        })
      }
    })
  }
}
