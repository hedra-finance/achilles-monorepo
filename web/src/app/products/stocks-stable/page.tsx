import { PageMotion } from '@/components/Motion'
import type { Metadata } from 'next'
import { ProductDetail } from '@/components/ProductDetail'

export const metadata: Metadata = { title: 'Stocks & Stable LP | Achilles' }

export default async function Page({
  searchParams
}: {
  searchParams: Promise<{ tranche?: string | string[] }>
}) {
  const { tranche } = await searchParams
  const layer = tranche === 'junior' ? 'Junior' : 'Senior'
  return (
    <PageMotion>
      <ProductDetail key={layer} initialLayer={layer} />
    </PageMotion>
  )
}
