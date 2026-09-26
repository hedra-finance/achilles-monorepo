'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useAccount } from 'wagmi'
import { useAppKit } from '@reown/appkit/react'
import { short } from '@/lib/math'
import { Brand } from './Brand'
import { Icon } from './Icon'

const LINKS = [
  { href: '/', label: 'Explore', icon: 'layers' },
  { href: '/portfolio', label: 'Portfolio', icon: 'wallet' },
  { href: '/activity', label: 'Activity', icon: 'activity' }
] as const

export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname()
  const { address, isConnected } = useAccount()
  const { open } = useAppKit()
  return (
    <div className="app-shell ir-shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="ir-header">
        <Link className="ir-brand" href="/" aria-label="Achilles home">
          <Brand />
        </Link>
        <nav className="ir-nav" aria-label="Main navigation">
          {LINKS.map(({ href, label, icon }) => (
            <Link
              key={href}
              href={href}
              className={path === href ? 'active' : ''}
              aria-current={path === href ? 'page' : undefined}
            >
              <Icon name={icon} size={16} />
              <span>{label}</span>
            </Link>
          ))}
        </nav>
        <div className="ir-header-actions">
          <span className="ir-network">
            <span className="status-dot amber" /> Sepolia testnet
          </span>
          <button
            className="btn wallet-button"
            onClick={() => open(isConnected ? { view: 'Account' } : undefined)}
          >
            <Icon name="wallet" size={16} />
            {isConnected && address ? short(address) : 'Connect wallet'}
          </button>
        </div>
      </header>
      <main id="main" className="ir-main">
        {children}
      </main>
      <footer className="ir-footer">
        <Link href="/" aria-label="Achilles home">
          <Brand />
        </Link>
        <p>Know the risk. Choose your layer.</p>
        <span>Experimental protocol · Testnet assets</span>
      </footer>
    </div>
  )
}
