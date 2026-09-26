'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useAccount } from 'wagmi'
import { useAppKit } from '@reown/appkit/react'
import { short } from '@/lib/math'
import { Brand } from './Brand'
import { Icon } from './Icon'

const LINKS = [
  { href: '/', label: 'Earn', icon: 'layers' },
  { href: '/portfolio', label: 'Portfolio', icon: 'wallet' },
  { href: '/activity', label: 'Activity', icon: 'activity' }
] as const

export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname()
  const { address, isConnected } = useAccount()
  const { open } = useAppKit()
  const current = LINKS.find((l) => l.href === path)
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <aside className="sidebar">
        <Link className="brand" href="/" aria-label="Achilles home">
          <Brand />
        </Link>
        <span className="nav-caption">WORKSPACE</span>
        <nav aria-label="Main navigation">
          {LINKS.map(({ href, label, icon }) => (
            <Link
              key={href}
              href={href}
              className={'nav-link' + (path === href ? ' active' : '')}
              aria-current={path === href ? 'page' : undefined}
            >
              <Icon name={icon} />
              <span>{label}</span>
              {path === href && <span className="nav-indicator" />}
            </Link>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="network-card">
            <span className="network-icon">
              <Icon name="globe" />
            </span>
            <strong>Built across networks</strong>
            <p>
              One strategy.
              <br />
              Connected capital.
            </p>
            <div className="network-pips">
              <span>S</span>
              <span>R</span>
              <span>H</span>
              <small>3 networks</small>
            </div>
          </div>
          <div className="sidebar-footer">
            <span className="status-dot amber" /> Testnet environment{' '}
            <span className="version">v0.1</span>
          </div>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <Link className="mobile-brand" href="/" aria-label="Achilles home">
            <Brand compact />
          </Link>
          <div className="breadcrumb">
            <span>Workspace</span>
            <Icon name="chevron" size={13} />
            <strong>{current?.label ?? 'Achilles'}</strong>
          </div>
          <div className="topbar-actions">
            <span className="network-pill">
              <span className="network-coin">◇</span> Sepolia{' '}
              <span className="testnet-label">Testnet</span>
            </span>
            <button
              className="btn wallet-button"
              onClick={() =>
                open(isConnected ? { view: 'Account' } : undefined)
              }
            >
              <Icon name="wallet" size={17} />
              {isConnected && address ? short(address) : 'Connect wallet'}
            </button>
          </div>
        </header>
        <main id="main" className="main-content">
          {children}
        </main>
        <footer className="app-footer">
          <span>
            ACHILLES <span className="footer-divider">/</span> Know the risk.
            Choose your layer.
          </span>
          <span>Testnet assets · Experimental protocol</span>
        </footer>
      </div>
    </div>
  )
}
