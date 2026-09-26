import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { Providers } from './providers'
import { Shell } from '@/components/Shell'
import './globals.css'

export const metadata: Metadata = { title: 'Achilles', description: 'Cross-chain tranche vaults across two networks, settled from a single hub' }

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const cookies = (await headers()).get('cookie')
  return (
    <html lang="en">
      <body>
        <Providers cookies={cookies}>
          <Shell>{children}</Shell>
        </Providers>
      </body>
    </html>
  )
}
