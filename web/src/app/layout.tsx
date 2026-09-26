import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { Providers } from './providers'
import { Shell } from '@/components/Shell'
import './globals.css'
import './experience.css'
import './markets.css'
import './landing.css'

export const metadata: Metadata = {
  title: 'Achilles | Structured cross-chain yield',
  description:
    'Structure any yield. On any chain. Explore the Achilles testnet strategy and choose your place in the capital structure.',
  icons: { icon: '/brand/achilles.png' }
}

export default async function RootLayout({
  children
}: {
  children: React.ReactNode
}) {
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
