import type { Metadata } from 'next'
import { ProductCatalog } from '@/components/ProductCatalog'

export const metadata: Metadata = { title: 'Products | Achilles' }

export default function Page() {
  return <ProductCatalog />
}
