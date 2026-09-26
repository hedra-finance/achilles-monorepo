'use client'
import { useState } from 'react'
import { MotionLink as Link } from '@/components/MotionLink'
import { usePathname } from 'next/navigation'
import { useWalletAccount } from '@/hooks/wallet'
import { useAppKit } from '@reown/appkit/react'
import { short } from '@/lib/math'
import { MotionToggle } from './Motion'
import { Brand } from './Brand'
import { Icon } from './Icon'

const LINKS = [
  { href: '/products', label: 'Products', icon: 'layers' },
  { href: '/portfolio', label: 'Portfolio', icon: 'wallet' },
  { href: '/activity', label: 'Activity', icon: 'activity' }
] as const
const LANDING_LINKS = [
  ['#strategy', 'Assets'],
  ['#tranches', 'Tranches'],
  ['#access', 'Access'],
  ['#settlement', 'Settlement'],
  ['#faq', 'FAQ']
] as const

export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname()
  const landing = path === '/'
  const [menuOpen, setMenuOpen] = useState(false)
  const { address, isConnected } = useWalletAccount()
  const { open } = useAppKit()
  return (
    <div className={`app-shell ir-shell ${landing ? 'landing-shell' : ''}`}>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header
        className={`ir-header ${landing ? 'landing-header' : ''}`}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setMenuOpen(false)
        }}
      >
        <Link
          className="ir-brand"
          href="/"
          aria-label="Achilles home"
          onClick={() => setMenuOpen(false)}
        >
          <Brand />
        </Link>
        {landing ? (
          <>
            <nav
              id="landing-nav"
              className={`landing-nav ${menuOpen ? 'open' : ''}`}
              aria-label="Main navigation"
            >
              {LANDING_LINKS.map(([href, label]) => (
                <a href={href} key={href} onClick={() => setMenuOpen(false)}>
                  {label}
                </a>
              ))}
            </nav>
            <div className="landing-header-actions">
              <button
                className="landing-menu btn"
                aria-expanded={menuOpen}
                aria-controls="landing-nav"
                onClick={() => setMenuOpen((v) => !v)}
              >
                {menuOpen ? 'Close' : 'Menu'}
                <Icon name={menuOpen ? 'close' : 'layers'} size={15} />
              </button>
              <Link
                className="btn primary"
                href="/products"
                onClick={() => setMenuOpen(false)}
              >
                Launch app <Icon name="arrow" size={14} />
              </Link>
            </div>
          </>
        ) : (
          <>
            <nav className="ir-nav" aria-label="Main navigation">
              {LINKS.map(({ href, label, icon }) => {
                const active = path === href || path.startsWith(`${href}/`)
                return (
                  <Link
                    key={href}
                    href={href}
                    className={active ? 'active' : ''}
                    aria-current={active ? 'page' : undefined}
                  >
                    <Icon name={icon} size={16} />
                    <span>{label}</span>
                  </Link>
                )
              })}
            </nav>
            <div className="ir-header-actions">
              <span className="ir-network">
                <span className="status-dot amber" /> Sepolia testnet
              </span>
              <button
                className="btn wallet-button"
                onClick={() =>
                  open(isConnected ? { view: 'Account' } : undefined)
                }
              >
                <Icon name="wallet" size={16} />
                {isConnected && address ? short(address) : 'Connect wallet'}
              </button>
            </div>
          </>
        )}
      </header>
      <div className="route-progress" aria-hidden="true">
        <i />
      </div>
      <main id="main" className="ir-main">
        {children}
      </main>
      <footer className="ir-footer site-footer">
        <div>
          <Link href="/" aria-label="Achilles home">
            <Brand />
          </Link>
          <p>Know the risk. Choose your layer.</p>
          <small>Experimental protocol · Testnet assets</small>
          <MotionToggle />
        </div>
        <nav aria-label="Explore Achilles">
          <strong>EXPLORE</strong>
          <Link href="/products">Products</Link>
          <Link href="/portfolio">Portfolio</Link>
          <Link href="/activity">Activity</Link>
        </nav>
        <nav aria-label="Learn about Achilles">
          <strong>UNDERSTAND</strong>
          <Link href="/#tranches">Tranches</Link>
          <Link href="/#access">Access</Link>
          <Link href="/#faq">FAQ</Link>
        </nav>
        <div className="footer-signoff">
          ACHILLES
          <span>
            Structure any yield.
            <br />
            On any chain.
          </span>
        </div>
      </footer>
    </div>
  )
}
