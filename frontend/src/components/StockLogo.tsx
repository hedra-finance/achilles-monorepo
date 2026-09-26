'use client'
import Image from 'next/image'
import { useState } from 'react'
import { stockDisplay } from '@/lib/stock-display'

export function StockLogo({ ticker }: { ticker: string }) {
  const [failed, setFailed] = useState(false)
  const { logo } = stockDisplay(ticker)
  return (
    <span className="stock-logo" aria-hidden="true">
      {logo && !failed ? (
        <Image
          src={logo}
          alt=""
          width={32}
          height={32}
          sizes="32px"
          onError={() => setFailed(true)}
        />
      ) : (
        <span>{ticker.slice(0, 1)}</span>
      )}
    </span>
  )
}
