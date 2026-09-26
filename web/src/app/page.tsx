'use client'
import Image from 'next/image'
import { useState } from 'react'
import { useProduct, useOverview } from '@/hooks/data'
import { NavChart } from '@/components/NavChart'
import { Ticket } from '@/components/Ticket'
import { Access } from '@/components/Access'
import { Allocation } from '@/components/Allocation'
import { Icon } from '@/components/Icon'
import { QueryNotice } from '@/components/State'
import { YieldFlow, type RiskLayer } from '@/components/YieldFlow'
import { RiskExplainer } from '@/components/RiskExplainer'
import { fmt, pct, juniorYieldPercent } from '@/lib/math'
import { hubConfigured } from '@/lib/chains'
import { PRODUCT } from '@/lib/product'

export default function ProductPage() {
  const product = useProduct()
  const ov = useOverview()
  const [selected, setSelected] = useState<RiskLayer>('Senior')
  const [transactionBusy, setTransactionBusy] = useState(false)
  const p = product.data
  const sr = p?.tranches.findIndex((t) => t.type === 'Senior') ?? -1
  const jr = p?.tranches.findIndex((t) => t.type === 'Junior') ?? -1
  const hist = ov.data?.history ?? []
  const series = (i: number) =>
    hist.map((h) => ({
      at: h.at,
      price: h.sharePrices[i] == null ? null : Number(h.sharePrices[i]) / 1e18
    }))
  const srApr = p && sr >= 0 ? Number(p.tranches[sr].apr) / 1e16 : null
  const jrY = juniorYieldPercent(series(jr))
  const last = ov.data?.last ?? null
  const time = last?.at?.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit'
  })
  return (
    <>
      <section className="ir-hero" aria-labelledby="hero-title">
        <div className="coast-scene" aria-hidden="true">
          <Image
            src="/scenes/midnight-coast.png"
            alt=""
            fill
            priority
            sizes="100vw"
          />
        </div>
        <div className="ir-intro">
          <span className="ir-kicker">
            <span className="spark" /> THE YIELD STRUCTURING PROTOCOL
          </span>
          <h1 id="hero-title">
            Structure any yield.
            <br />
            <span>On any chain.</span>
          </h1>
          <p>One strategy. Two ways to take risk. Your choice.</p>
          <a className="ir-mobile-jump" href="#position">
            Choose your layer <Icon name="arrow" size={13} />
          </a>
        </div>
        <YieldFlow
          selected={selected}
          disabled={transactionBusy}
          onSelect={setSelected}
        />
        <div className="hero-continue">
          <span>
            <span className="status-dot amber" /> Testnet experience <i />{' '}
            Stocks + stablecoin liquidity
          </span>
          <a className="btn primary" href="#position">
            Continue with {selected}
            <Icon name="arrow" size={16} />
          </a>
        </div>
      </section>
      <div className="ir-stats" aria-label="Strategy overview">
        <div>
          <span>STRATEGY VALUE</span>
          <strong>
            {fmt(last?.productNav, p?.decimals ?? 6, 0)} <small>USDC</small>
          </strong>
          <p>
            {last
              ? `Finalized settlement #${last.id}`
              : 'Awaiting settlement data'}
          </p>
        </div>
        <div>
          <span>
            <i className="legend-dot senior" /> SENIOR TARGET APR
          </span>
          <strong>{pct(srApr)}</strong>
          <p>Priority yield · not guaranteed</p>
        </div>
        <div>
          <span>
            <i className="legend-dot junior" /> JUNIOR{' '}
            {jrY.annualized ? 'REALIZED APR' : 'PERIOD RETURN'}
          </span>
          <strong>{pct(jrY.percent)}</strong>
          <p>Residual yield · first-loss exposure</p>
        </div>
        <div>
          <span>STRATEGY COMPOSITION</span>
          <strong>
            {PRODUCT.weights[PRODUCT.robinhood.chainId] / 100} <small>/</small>{' '}
            {PRODUCT.weights[PRODUCT.sepolia.chainId] / 100}{' '}
            <small>target</small>
          </strong>
          <p>Stock basket + stablecoin LP</p>
        </div>
      </div>
      {!hubConfigured ? (
        <QueryNotice title="Live data is not connected yet">
          Explore the strategy and choose a layer. Live values appear when the
          network connection is configured.
        </QueryNotice>
      ) : product.isError ? (
        <QueryNotice
          title="The settlement network is unavailable"
          retry={() => {
            void product.refetch()
          }}
          busy={product.isFetching}
        >
          Your wallet is unchanged. Try refreshing the connection.
        </QueryNotice>
      ) : ov.isError || ov.data?.issues.length ? (
        <QueryNotice
          title="Some live data is unavailable"
          retry={() => {
            void ov.refetch()
          }}
          busy={ov.isFetching}
        >
          Available values are shown. Missing values remain marked with a dash.
        </QueryNotice>
      ) : null}
      <section
        id="position"
        className="position-section"
        aria-labelledby="position-title"
      >
        <div className="ir-section-heading">
          <div>
            <span className="eyebrow">01 / CHOOSE YOUR POSITION</span>
            <h2 id="position-title">
              Your capital. <span>Your terms.</span>
            </h2>
          </div>
          <p>
            The same underlying strategy.
            <br />A different place in the capital structure.
          </p>
        </div>
        <div className="position-layout">
          <div className="position-guide">
            <div
              className="profile-selector"
              role="group"
              aria-label="Risk profile"
            >
              <button
                disabled={transactionBusy}
                aria-pressed={selected === 'Senior'}
                className={selected === 'Senior' ? 'selected' : ''}
                onClick={() => setSelected('Senior')}
              >
                <Icon name="shield" size={21} />
                <span>
                  <strong>Senior</strong>
                  <small>Prioritize yield</small>
                </span>
                <span className="radio-indicator" />
              </button>
              <button
                disabled={transactionBusy}
                aria-pressed={selected === 'Junior'}
                className={
                  'junior' + (selected === 'Junior' ? ' selected' : '')
                }
                onClick={() => setSelected('Junior')}
              >
                <Icon name="chart" size={21} />
                <span>
                  <strong>Junior</strong>
                  <small>Take residual upside</small>
                </span>
                <span className="radio-indicator" />
              </button>
            </div>
            <div
              className={'selected-profile ' + selected.toLowerCase()}
              aria-live="polite"
            >
              <span className="eyebrow">
                {selected === 'Senior'
                  ? 'AHEAD IN THE YIELD QUEUE'
                  : 'FIRST LOSS. RESIDUAL REWARD.'}
              </span>
              <h3>
                {selected === 'Senior'
                  ? 'Let priority work for you.'
                  : 'Take a different side of yield.'}
              </h3>
              <p>
                {selected === 'Senior'
                  ? 'Receive available yield first, up to the target rate. Junior capital absorbs losses before your layer.'
                  : 'Receive the yield left after Senior’s allocation. In exchange, your capital absorbs the strategy’s losses first.'}
              </p>
              <div className="profile-rate">
                <span>
                  {selected === 'Senior'
                    ? 'Target APR'
                    : jrY.annualized
                      ? 'Realized APR'
                      : 'Period return'}
                </span>
                <strong>
                  {selected === 'Senior' ? pct(srApr) : pct(jrY.percent)}
                </strong>
              </div>
            </div>
            <RiskExplainer selected={selected} />
            <div className="settlement-journey">
              <span className="eyebrow">A REQUEST, THEN A SETTLEMENT.</span>
              <div>
                <span>
                  <b>01</b>Request
                </span>
                <Icon name="arrow" size={14} />
                <span>
                  <b>02</b>Settle
                </span>
                <Icon name="arrow" size={14} />
                <span>
                  <b>03</b>Claim
                </span>
              </div>
              <p>
                Deposits become claimable shares after settlement. Redemptions
                follow the same cycle; withdrawals are not instant.
              </p>
            </div>
          </div>
          <aside className="ir-ticket-column">
            <div className="ticket-context">
              <span className="spark" /> BUILD YOUR POSITION{' '}
              <span>SEPOLIA</span>
            </div>
            <Ticket
              product={p}
              last={last}
              type={selected}
              onTypeChange={setSelected}
              onBusyChange={setTransactionBusy}
            />
            <Access />
          </aside>
        </div>
      </section>
      <section className="ir-performance" aria-labelledby="performance-title">
        <div className="ir-section-heading">
          <div>
            <span className="eyebrow">02 / FOLLOW THE PERFORMANCE</span>
            <h2 id="performance-title">
              Every settlement. <span>In view.</span>
            </h2>
          </div>
          <span className="period-label">
            {time ? `Updated ${time}` : 'Settlement history'}
          </span>
        </div>
        <div className="card performance-card">
          <div className="chart-legend">
            <span>
              <i className="legend-dot senior" /> Senior
            </span>
            <span>
              <i className="legend-dot junior" /> Junior
            </span>
            <span className="chart-unit">USDC / share</span>
          </div>
          <NavChart history={hist} sr={sr} jr={jr} />
          <div className="chart-footer">
            <Icon name="info" size={14} />
            Finalized on-chain share prices. Past returns do not guarantee
            future performance.
          </div>
        </div>
      </section>
      <section
        id="strategy"
        className="ir-allocation"
        aria-labelledby="strategy-title"
      >
        <div className="ir-section-heading">
          <div>
            <span className="eyebrow">03 / LOOK UNDER THE SURFACE</span>
            <h2 id="strategy-title">
              Know where <span>your capital goes.</span>
            </h2>
          </div>
          <span className="pill">Configured testnet strategy</span>
        </div>
        <Allocation
          product={p}
          sources={ov.data?.sources ?? []}
          sourcesUnavailable={
            !hubConfigured ||
            !!ov.data?.issues.includes('sources') ||
            ov.isError
          }
        />
      </section>
      <section id="vision" className="vision-section">
        <span className="eyebrow">THE VISION / BEYOND THIS STRATEGY</span>
        <h2>
          One layer.
          <br />
          <span>A wider world of yield.</span>
        </h2>
        <p>
          Achilles is designed around a simple idea: separate where yield comes
          from from how you take risk.
        </p>
        <div className="vision-grid">
          {[
            {
              title: 'DeFi lending',
              icon: 'wallet',
              text: 'Money-market strategies'
            },
            {
              title: 'Treasuries & bonds',
              icon: 'shield',
              text: 'Fixed-income exposure'
            },
            {
              title: 'Real-world assets',
              icon: 'globe',
              text: 'Credit and real estate'
            },
            {
              title: 'Custom strategies',
              icon: 'layers',
              text: 'A broader strategy design space'
            }
          ].map((v) => (
            <div key={v.title}>
              <Icon
                name={v.icon as 'wallet' | 'shield' | 'globe' | 'layers'}
                size={24}
              />
              <h3>{v.title}</h3>
              <p>{v.text}</p>
              <span>Planned · not available</span>
            </div>
          ))}
        </div>
        <p className="vision-disclosure">
          These categories describe the product vision. The current testnet
          experience is limited to the stock basket and stablecoin LP shown
          above.
        </p>
        <a className="text-link" href="#position">
          Find your layer <Icon name="arrow" size={15} />
        </a>
      </section>
    </>
  )
}
