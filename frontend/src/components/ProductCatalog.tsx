'use client'
import { useState } from 'react'
import { MotionLink as Link } from '@/components/MotionLink'
import { PRODUCT } from '@/lib/product'
import { fmt, pct } from '@/lib/math'
import { useStrategySnapshot } from '@/hooks/strategy'
import { Icon } from './Icon'
import { LoadingValue } from './Skeleton'
import { StockLogo } from './StockLogo'

export function ProductCatalog() {
  const [search, setSearch] = useState('')
  const [view, setView] = useState<'list' | 'cards'>('list')
  const s = useStrategySnapshot()
  const matches =
    `${PRODUCT.name} technology stocks liquidity USDC USDT Sepolia Robinhood ${PRODUCT.robinhood.basket.map((b) => `${b.symbol} ${b.name}`).join(' ')}`
      .toLowerCase()
      .includes(search.trim().toLowerCase())
  return (
    <div className="product-catalog">
      <div className="catalog-heading">
        <div>
          <span className="eyebrow">THE ACHILLES APP</span>
          <h1>Products</h1>
          <p>
            Explore the underlying assets. Choose a product, then your risk
            layer.
          </p>
        </div>
      </div>
      <div className="catalog-stats">
        <div>
          <span>RECORDED STRATEGY NAV</span>
          <strong>
            <LoadingValue loading={s.loading}>
              {fmt(s.last?.productNav, s.decimals)}
            </LoadingValue>{' '}
            <small>USDC</small>
          </strong>
        </div>
        <div>
          <span>TESTNET PRODUCTS</span>
          <strong>01</strong>
        </div>
        <div>
          <span>DEPOSIT NETWORK</span>
          <strong>
            Sepolia <small>USDC</small>
          </strong>
        </div>
        <p>
          <span className="status-dot amber" /> Experimental strategies.
          <br />
          Both layers carry risk of capital loss.
        </p>
      </div>
      <div className="catalog-toolbar">
        <span className="catalog-filter">
          All products <b>1</b>
        </span>
        <label>
          <span className="sr-only">Search products or assets</span>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search product or asset…"
          />
        </label>
        <div className="seg" role="group" aria-label="Product layout">
          <button
            aria-pressed={view === 'list'}
            className={view === 'list' ? 'on' : ''}
            onClick={() => setView('list')}
          >
            List
          </button>
          <button
            aria-pressed={view === 'cards'}
            className={view === 'cards' ? 'on' : ''}
            onClick={() => setView('cards')}
          >
            Cards
          </button>
        </div>
      </div>
      {matches ? (
        <div key={view} className={`catalog-results ${view} content-enter`}>
          {view === 'list' && (
            <div className="catalog-table-head" aria-hidden="true">
              <span>Product / underlying assets</span>
              <span>Recorded NAV</span>
              <span>Senior target APR</span>
              <span>
                Junior {s.junior.annualized ? 'realized APR' : 'period return'}
              </span>
              <span>Deposit network</span>
            </div>
          )}
          <Link
            href="/products/stocks-stable"
            className="catalog-product"
            aria-label="View Stocks & Stable LP product"
          >
            <div className="catalog-product-identity">
              <div className="catalog-product-icon">
                <Icon name="layers" size={27} />
              </div>
              <div>
                <span className="product-status">TESTNET</span>
                <h2>{PRODUCT.name}</h2>
                <p>
                  {PRODUCT.robinhood.basket.length} technology stocks +
                  stablecoin liquidity
                </p>
                <div className="catalog-stock-marks">
                  {PRODUCT.robinhood.basket.map((b) => (
                    <StockLogo ticker={b.symbol} key={b.symbol} />
                  ))}
                </div>
              </div>
            </div>
            <div className="catalog-number">
              <small>Recorded NAV</small>
              <strong>
                <LoadingValue loading={s.loading}>
                  {fmt(s.last?.productNav, s.decimals)}
                </LoadingValue>
              </strong>
              <span>USDC</span>
            </div>
            <div className="catalog-number senior">
              <small>Senior target APR</small>
              <strong>
                <LoadingValue loading={s.loading}>
                  {pct(s.seniorApr)}
                </LoadingValue>
              </strong>
              <span>Priority yield</span>
            </div>
            <div className="catalog-number junior">
              <small>
                Junior {s.junior.annualized ? 'realized APR' : 'period return'}
              </small>
              <strong>
                <LoadingValue loading={s.loading}>
                  {pct(s.junior.percent)}
                </LoadingValue>
              </strong>
              <span>First-loss exposure</span>
            </div>
            <div className="catalog-network">
              <span>
                <Icon name="globe" size={14} /> Sepolia
              </span>
              <b>
                View product <Icon name="arrow" size={16} />
              </b>
            </div>
          </Link>
        </div>
      ) : (
        <div className="catalog-empty">
          <Icon name="layers" size={28} />
          <h2>No matching products</h2>
          <p>Try a stock ticker, USDC or the product name.</p>
          <button className="btn" onClick={() => setSearch('')}>
            Clear search
          </button>
        </div>
      )}
      <p className="catalog-data-note" role="status">
        {s.issue
          ? 'Some on-chain data is unavailable. Missing values are shown as a dash.'
          : s.loading
            ? 'Loading recorded strategy data…'
            : s.last
              ? `Valued at finalized settlement #${s.last.id}.`
              : 'Awaiting the first recorded settlement.'}{' '}
        APR targets are not guaranteed returns.
      </p>
      <details className="catalog-guide">
        <summary>
          New to structured yield? <Icon name="chevron" size={14} />
        </summary>
        <div className="catalog-guide-body">
          <span className="eyebrow">BEFORE YOU INVEST</span>
          <h2>Know the assets. Understand your layer.</h2>
          <ol className="catalog-guide-steps">
            <li>
              <b aria-hidden="true">01</b> Inspect prices, holdings and
              allocation.
            </li>
            <li>
              <b aria-hidden="true">02</b> Compare Senior and Junior exposure.
            </li>
            <li>
              <b aria-hidden="true">03</b> Prepare your wallet, then review your
              request.
            </li>
          </ol>
        </div>
      </details>
    </div>
  )
}
