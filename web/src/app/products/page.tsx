import { PageMotion } from '@/components/Motion'
import type { Metadata } from 'next'
import { ProductCatalog } from '@/components/ProductCatalog'

export const metadata: Metadata = { title: 'Products | Achilles' }

export default function Page() {
  return (
    <PageMotion>
      <ProductCatalog />
    </PageMotion>
  )
}
