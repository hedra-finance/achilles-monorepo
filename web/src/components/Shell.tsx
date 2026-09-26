'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useAccount, useDisconnect } from 'wagmi'
import { useAppKit } from '@reown/appkit/react'
import { short } from '@/lib/math'

const LINKS = [['/', 'Product'], ['/portfolio', 'Portfolio'], ['/activity', 'Activity']] as const

export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname()
  const { address, isConnected } = useAccount()
  const { open } = useAppKit()
  const { disconnect } = useDisconnect()
  return (
    <>
      <header className="nav">
        <div className="wrap row" style={{ height: '100%', flexWrap: 'nowrap' }}>
          <Link className="brand" href="/">Achilles</Link>
          {LINKS.map(([href, label]) => <Link key={href} href={href} className={`link${path === href ? ' on' : ''}`}>{label}</Link>)}
          <span className="spacer" />
          {isConnected && address
            ? <button className="btn sm" onClick={() => disconnect()} title="Disconnect"><span className="mono">{short(address)}</span></button>
            : <button className="btn sm primary" onClick={() => open()}>Connect wallet</button>}
        </div>
      </header>
      <main className="wrap" style={{ padding: '20px 20px 60px' }}>{children}</main>
    </>
  )
}
