import { PageMotion } from '@/components/Motion'
import type { Metadata } from 'next'
import { ProductDetail } from '@/components/ProductDetail'

export const metadata: Metadata = { title: 'Stocks & Stable LP | Achilles' }

export default async function Page({
  searchParams
}: {
  searchParams: Promise<{
    tranche?: string | string[]
    mode?: string | string[]
  }>
}) {
  const { tranche, mode } = await searchParams
  const layer = tranche === 'junior' ? 'Junior' : 'Senior'
  const ticketMode = mode === 'redeem' ? 'redeem' : 'invest'
  return (
    <PageMotion>
      <ProductDetail
        key={`${layer}-${ticketMode}`}
        initialLayer={layer}
        initialMode={ticketMode}
      />
    </PageMotion>
  )
}
