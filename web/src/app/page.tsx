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
import {
  fmt,
  pct,
  settlementAvgAprPercent,
  juniorYieldPercent,
  nextSettlement
} from '@/lib/math'
import { PRODUCT } from '@/lib/product'
import { hubConfigured } from '@/lib/chains'

export default function ProductPage() {
  const product = useProduct()
  const ov = useOverview()
  const [selected, setSelected] = useState<'Senior' | 'Junior'>('Senior')
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
  const srReal = sr >= 0 ? settlementAvgAprPercent(series(sr)) : null
  const jrY = juniorYieldPercent(series(jr))
  const last = ov.data?.last ?? null
  const next =
    p && p.settlement.length > 0 ? nextSettlement(p.settlement) : null
  const loading = hubConfigured && product.isPending
  return (
    <>
      <div className="page-topline">
        <span className="eyebrow">THE ACHILLES VAULT</span>
        <span className="pill">
          <span className="status-dot amber" /> Testnet
        </span>
      </div>
      <section className="strategy-hero">
        <div className="hero-copy">
          <h1>
            One strategy.
            <br />
            <span>Your choice of risk.</span>
          </h1>
          <p>
            Put your capital to work across tokenized stocks and stablecoin
            liquidity. Choose the layer that fits you.
          </p>
          <div className="hero-chips">
            <span>
              <span className="usdc-symbol">$</span> Deposit USDC
            </span>
            <span>
              <Icon name="layers" size={15} /> Two risk profiles
            </span>
            <span>
              <Icon name="globe" size={15} /> Cross-chain
            </span>
          </div>
        </div>
        <div className="hero-art">
          <Image
            src="/brand/achilles.png"
            alt="Achilles — blue A, warrior helmet, and layered capital"
            width={1302}
            height={998}
            priority
            sizes="(max-width: 700px) 240px, 340px"
          />
        </div>
      </section>
      {!hubConfigured ? (
        <QueryNotice title="Live data is not connected yet">
          Explore the strategy below. Balances, rates, and transactions will be
          available when the network connection is configured.
        </QueryNotice>
      ) : product.isError ? (
        <QueryNotice
          title="We couldn’t reach the settlement network"
          retry={() => {
            void product.refetch()
          }}
          busy={product.isFetching}
        >
          Your wallet is unchanged. Try loading the product again.
        </QueryNotice>
      ) : ov.data?.issues.length || ov.isError ? (
        <QueryNotice
          title="Some live data is unavailable"
          retry={() => {
            void ov.refetch()
          }}
          busy={ov.isFetching}
        >
          Available values are shown below. Missing values are marked with a
          dash.
        </QueryNotice>
      ) : null}
      <div className="metrics-grid">
        <div className="metric">
          <div className="metric-label">
            Total strategy value <Icon name="coins" size={17} />
          </div>
          <div className={'metric-value' + (loading ? ' skeleton-text' : '')}>
            {fmt(last?.productNav, p?.decimals ?? 6, 0)}
            <small>USDC</small>
          </div>
          <div className="metric-foot">
            {last ? 'Settlement #' + last.id : 'Awaiting settlement data'}
            <span className="metric-tag">NAV</span>
          </div>
        </div>
        <div className="metric">
          <div className="metric-label">
            <span className="legend-dot senior" />
            Senior target APR <Icon name="shield" size={17} />
          </div>
          <div className="metric-value senior-text">{pct(srApr)}</div>
          <div className="metric-foot">
            Priority yield allocation{' '}
            <span>
              {srReal == null ? 'Target rate' : pct(srReal) + ' realized'}
            </span>
          </div>
        </div>
        <div className="metric">
          <div className="metric-label">
            <span className="legend-dot junior" />
            Junior {jrY.annualized ? 'realized APR' : 'period return'}{' '}
            <Icon name="chart" size={17} />
          </div>
          <div className="metric-value junior-text">{pct(jrY.percent)}</div>
          <div className="metric-foot">
            Residual upside · first-loss risk<span>Variable</span>
          </div>
        </div>
      </div>
      <div className="invest-layout">
        <div className="strategy-content">
          <section className="card performance-card">
            <div className="section-heading">
              <div>
                <span className="eyebrow">PERFORMANCE</span>
                <h2>Share price over time</h2>
              </div>
              <span className="period-label">Settlement history</span>
            </div>
            <div className="chart-legend">
              <span>
                <i className="legend-dot senior" />
                Senior
              </span>
              <span>
                <i className="legend-dot junior" />
                Junior
              </span>
              <span className="chart-unit">USDC / share</span>
            </div>
            <NavChart history={hist} sr={sr} jr={jr} />
            <div className="chart-footer">
              <Icon name="clock" size={15} />
              <span>
                {next
                  ? 'Next cycle · ' +
                    next.cycleEnd.toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit'
                    })
                  : 'Prices update after each settlement'}
              </span>
              <span>
                {last?.at
                  ? 'Last update ' +
                    last.at.toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit'
                    })
                  : 'On-chain settlement data'}
              </span>
            </div>
          </section>
          <section className="risk-section">
            <div className="section-heading">
              <div>
                <span className="eyebrow">CHOOSE YOUR LAYER</span>
                <h2>Same strategy. Different exposure.</h2>
              </div>
            </div>
            <div className="risk-grid">
              <button
                disabled={transactionBusy}
                className={
                  'risk-card senior-card' +
                  (selected === 'Senior' ? ' selected' : '')
                }
                aria-pressed={selected === 'Senior'}
                onClick={() => setSelected('Senior')}
              >
                <div className="risk-card-top">
                  <span className="risk-icon">
                    <Icon name="shield" size={21} />
                  </span>
                  <span className="radio-indicator" />
                </div>
                <h3>Senior</h3>
                <span className="risk-label">PRIORITY YIELD</span>
                <p>
                  Receives yield first, up to its target rate. Junior capital
                  absorbs losses first.
                </p>
                <span className="risk-card-foot">
                  Lower relative risk <Icon name="arrow" size={16} />
                </span>
              </button>
              <button
                disabled={transactionBusy}
                className={
                  'risk-card junior-card' +
                  (selected === 'Junior' ? ' selected' : '')
                }
                aria-pressed={selected === 'Junior'}
                onClick={() => setSelected('Junior')}
              >
                <div className="risk-card-top">
                  <span className="risk-icon">
                    <Icon name="chart" size={21} />
                  </span>
                  <span className="radio-indicator" />
                </div>
                <h3>Junior</h3>
                <span className="risk-label">RESIDUAL UPSIDE</span>
                <p>
                  Receives yield after Senior. Takes the first losses in
                  exchange for variable upside.
                </p>
                <span className="risk-card-foot">
                  Higher risk & reward <Icon name="arrow" size={16} />
                </span>
              </button>
            </div>
            <p className="risk-note">
              <Icon name="info" size={14} />
              Both tranches can lose capital. Target rates are not guaranteed
              returns.
            </p>
          </section>
        </div>
        <aside className="ticket-column">
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
      <section className="allocation-section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">BEHIND THE STRATEGY</span>
            <h2>{PRODUCT.name}</h2>
          </div>
          <span className="pill">
            <Icon name="globe" size={14} /> Two yield networks
          </span>
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
      <section className="journey-strip">
        <div>
          <span>01</span>
          <strong>Request</strong>
          <p>Choose a tranche and deposit USDC on Sepolia.</p>
        </div>
        <Icon name="arrow" size={18} />
        <div>
          <span>02</span>
          <strong>Settle</strong>
          <p>Your request is processed in a settlement cycle.</p>
        </div>
        <Icon name="arrow" size={18} />
        <div>
          <span>03</span>
          <strong>Claim</strong>
          <p>Claim your shares, then track your position.</p>
        </div>
      </section>
    </>
  )
}
