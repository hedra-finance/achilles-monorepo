import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { Providers } from './providers'
import { Shell } from '@/components/Shell'
import './globals.css'

export const metadata: Metadata = {
  title: 'Achilles | Structured cross-chain yield',
  description:
    'One strategy. Your choice of risk. Explore Senior and Junior tranches across tokenized stocks and stablecoin liquidity.',
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
