'use client'
import Image from 'next/image'
import { MotionLink as Link } from '@/components/MotionLink'
import { useState } from 'react'
import { useAccount } from 'wagmi'
import { useProduct, useOverview, useAccountData } from '@/hooks/data'
import { NavChart } from '@/components/NavChart'
import { PoolActivity } from '@/components/PoolActivity'
import { Ticket } from '@/components/Ticket'
import { Allocation } from '@/components/Allocation'
import { SettlementHistory } from '@/components/SettlementHistory'
import { Icon } from '@/components/Icon'
import { QueryNotice } from '@/components/State'
import type { RiskLayer } from '@/components/YieldFlow'
import { RiskExplainer } from '@/components/RiskExplainer'
import { fmt, pct, displayYieldPercent } from '@/lib/math'
import { hubConfigured } from '@/lib/chains'
import { LoadingValue } from './Skeleton'
import { PRODUCT } from '@/lib/product'

export function ProductDetail({
  initialLayer = 'Senior'
}: {
  initialLayer?: RiskLayer
}) {
  const product = useProduct()
  const ov = useOverview()
  const acct = useAccountData()
  const { address } = useAccount()
  const [selected, setSelected] = useState<RiskLayer>(initialLayer)
  const [transactionBusy, setTransactionBusy] = useState(false)
  const p = product.data
  const sr =
    p?.tranches.findIndex(
      (t) => t.type === 'Senior' && t.chainId === PRODUCT.entryChains[0]
    ) ?? -1
  const jr =
    p?.tranches.findIndex(
      (t) => t.type === 'Junior' && t.chainId === PRODUCT.entryChains[0]
    ) ?? -1
  const index = selected === 'Senior' ? sr : jr
  const hist = ov.data?.history ?? []
  const srApr = p && sr >= 0 ? Number(p.tranches[sr].apr) / 1e16 : null
  const jrY = displayYieldPercent(
    hist.map((h) => ({
      at: h.at,
      price: h.sharePrices[jr] == null ? null : Number(h.sharePrices[jr]) / 1e18
    }))
  )
  const selectedYield = displayYieldPercent(
    hist.map((h) => ({
      at: h.at,
      price:
        h.sharePrices[index] == null
          ? null
          : Number(h.sharePrices[index]) / 1e18
    }))
  )
  const last = ov.data?.last ?? null
  const sharePrice = last?.sharePrices[index]
  const position = acct.data?.positions.find(
    (position) => position.index === index
  )
  const dec = p?.decimals ?? 6
  const positionValue =
    position && sharePrice != null
      ? (position.shares * sharePrice) / 10n ** 18n
      : null
  const dataUnavailable = !hubConfigured || product.isError || ov.isError
  const loading = hubConfigured && (product.isPending || (!!p && ov.isPending))
  return (
    <div className="market-experience">
      <nav className="product-breadcrumb" aria-label="Breadcrumb">
        <Link href="/products">← Products</Link>
        <span>/</span>
        <span>{PRODUCT.name}</span>
      </nav>
      <section className="strategy-banner" aria-labelledby="strategy-heading">
        <div className="coast-scene" aria-hidden="true">
          <Image
            src="/scenes/midnight-coast.png"
            alt=""
            fill
            priority
            sizes="100vw"
          />
        </div>
        <div className="strategy-banner-copy">
          <span className="ir-kicker">
            <span className="spark" /> ACHILLES / STRUCTURED YIELD
          </span>
          <h1 id="strategy-heading">
            Stocks & <span>Stable LP.</span>
          </h1>
          <p>
            Technology exposure. Liquidity income.
            <br />
            One portfolio, with a layer of risk that fits you.
          </p>
          <div className="strategy-tags">
            <span>
              <span className="status-dot amber" /> Testnet strategy
            </span>
            <span>{PRODUCT.robinhood.basket.length} stocks + USDC / USDT</span>
            <span>Deposit on Sepolia</span>
          </div>
        </div>
        <div className="strategy-brand-art">
          <Image
            src="/brand/achilles.png"
            alt="Achilles — helmet, A and layered capital"
            width={340}
            height={260}
            priority
          />
          <span>KNOW THE RISK. CHOOSE YOUR LAYER.</span>
        </div>
      </section>
      <div className="strategy-context-bar">
        <div>
          <small>STRATEGY NAV</small>
          <strong>
            <LoadingValue loading={loading}>
              {fmt(last?.productNav, dec)}
            </LoadingValue>{' '}
            <span>USDC</span>
          </strong>
        </div>
        <div>
          <small>CAPITAL TARGET</small>
          <strong>
            {PRODUCT.weights[PRODUCT.robinhood.chainId] / 100}% stocks{' '}
            <span>/</span> {PRODUCT.weights[PRODUCT.sepolia.chainId] / 100}% LP
          </strong>
        </div>
        <div>
          <small>SETTLEMENT</small>
          <strong>
            {last ? `#${last.id}` : 'Awaiting data'}
            <span>
              {last?.at
                ? last.at.toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit'
                  })
                : 'On-chain finalization'}
            </span>
          </strong>
        </div>
        <a className="btn primary" href="#invest">
          Build your position <Icon name="arrow" size={14} />
        </a>
      </div>
      <nav className="strategy-nav" aria-label="Strategy sections">
        <a href="#position">Your layer</a>
        <a href="#performance">Performance</a>
        <a href="#strategy">Assets & prices</a>
        <a href="#settlements">Settlements</a>
        <a href="#pool-activity">On-chain activity</a>
        <a href="#how-it-works">
          How it works <Icon name="arrow" size={12} />
        </a>
      </nav>
      {!hubConfigured ? (
        <QueryNotice title="Settlement data is not connected yet">
          You can still inspect source pools below. Investment opens when the
          product connection is ready.
        </QueryNotice>
      ) : product.isError ? (
        <QueryNotice
          title="Settlement data is unavailable"
          retry={() => void product.refetch()}
          busy={product.isFetching}
        >
          Source prices are loaded independently. Your wallet is unchanged.
        </QueryNotice>
      ) : ov.isError || ov.data?.issues.length ? (
        <QueryNotice
          title="Some settlement data is unavailable"
          retry={() => void ov.refetch()}
          busy={ov.isFetching}
        >
          Available values remain visible. Missing values are marked with a
          dash.
        </QueryNotice>
      ) : null}
      <div className="trading-layout">
        <div className="research-column">
          <section
            id="position"
            className="layer-workspace"
            aria-labelledby="layer-title"
          >
            <div className="desk-heading">
              <div>
                <span className="eyebrow">01 / CHOOSE YOUR LAYER</span>
                <h2 id="layer-title">Same assets. Different exposure.</h2>
              </div>
            </div>
            <div
              className="market-layer-selector"
              role="group"
              aria-label="Risk profile"
            >
              {(['Senior', 'Junior'] as const).map((layer) => (
                <button
                  key={layer}
                  disabled={transactionBusy}
                  aria-pressed={selected === layer}
                  className={`${layer.toLowerCase()} ${selected === layer ? 'selected' : ''}`}
                  onClick={() => setSelected(layer)}
                >
                  <div>
                    <Icon
                      name={layer === 'Senior' ? 'shield' : 'chart'}
                      size={19}
                    />
                    <strong>{layer}</strong>
                    <span className="radio-indicator" />
                  </div>
                  <span className="layer-yield">
                    <LoadingValue loading={loading}>
                      {layer === 'Senior' ? pct(srApr) : pct(jrY.percent)}
                    </LoadingValue>
                    <small>
                      {layer === 'Senior'
                        ? 'Target APR'
                        : jrY.annualized
                          ? 'Realized APR'
                          : 'Period return'}
                    </small>
                  </span>
                  <p>
                    {layer === 'Senior'
                      ? 'Priority yield · paid before Junior'
                      : 'Residual yield · first-loss capital'}
                  </p>
                </button>
              ))}
            </div>
            <p className="layer-sync-note">
              <Icon name="layers" size={13} />
              Metrics, chart and investment ticket follow your selected layer.
            </p>
            <div
              className="layer-metrics"
              aria-label={`${selected} metrics`}
              aria-live="polite"
            >
              <div>
                <span>SHARE PRICE</span>
                <strong>
                  <LoadingValue loading={loading}>
                    {fmt(sharePrice, 18, 6)}
                  </LoadingValue>
                </strong>
                <small>USDC / {selected} share</small>
              </div>
              <div>
                <span>TRANCHE NAV</span>
                <strong>
                  <LoadingValue loading={loading}>
                    {fmt(last?.trancheNavs[index], dec)}
                  </LoadingValue>
                </strong>
                <small>USDC · finalized</small>
              </div>
              <div>
                <span>YOUR POSITION</span>
                <strong>{fmt(positionValue, dec)}</strong>
                <small>
                  {address
                    ? `${fmt(position?.shares, dec, 4)} shares`
                    : 'Connect wallet to view'}
                </small>
              </div>
              <div>
                <span>YIELD PRIORITY</span>
                <strong>{selected === 'Senior' ? 'First' : 'Residual'}</strong>
                <small>
                  {selected === 'Senior'
                    ? 'Junior absorbs losses first'
                    : 'Junior absorbs losses first'}
                </small>
              </div>
            </div>
          </section>
          <section
            id="performance"
            className="card market-performance"
            aria-labelledby="performance-title"
          >
            <div className="desk-heading">
              <div>
                <span className="eyebrow">02 / PRICE OF YOUR LAYER</span>
                <h2 id="performance-title">{selected} performance</h2>
              </div>
              <span className={`pill ${selected.toLowerCase()}`}>
                {selected}
              </span>
            </div>
            <p className="performance-return">
              <strong>{pct(selectedYield.percent)}</strong>
              {selectedYield.annualized
                ? ' realized APR across recorded intervals'
                : ' return over recorded history'}
              <small>
                {selectedYield.annualized
                  ? 'Annualized historical performance, not a forecast.'
                  : 'Short histories are not annualized.'}
              </small>
            </p>
            <NavChart
              loading={loading}
              history={hist}
              sr={sr}
              jr={jr}
              selected={selected}
            />
          </section>
          <Allocation
            sourcesLoading={loading}
            history={hist}
            product={p}
            sources={ov.data?.sources ?? []}
            sourcesUnavailable={
              dataUnavailable ||
              !ov.data ||
              !!ov.data.issues.includes('sources')
            }
          />
          <PoolActivity />
          <section id="how-it-works" className="detail-settlement card">
            <div className="desk-heading">
              <div>
                <span className="eyebrow">HOW IT SETTLES</span>
                <h2>From request to claim.</h2>
              </div>
            </div>
            <ol className="settlement-stages">
              {[
                [
                  'Request',
                  'Submit a deposit or redemption request on Sepolia.'
                ],
                [
                  'Bridge & batch',
                  'Your request reaches the settlement hub and joins a round.'
                ],
                [
                  'Value & settle',
                  'Recorded asset valuations determine share prices and the Senior / Junior allocation.'
                ],
                [
                  'Claim',
                  'Once claimable, receive shares for a deposit or USDC for a redemption.'
                ]
              ].map(([title, text], i) => (
                <li key={title}>
                  <b>0{i + 1}</b>
                  <div>
                    <h3>{title}</h3>
                    <p>{text}</p>
                  </div>
                </li>
              ))}
            </ol>
            <Link className="text-link" href="/#tranches">
              Learn how the risk layers work <Icon name="arrow" size={14} />
            </Link>
          </section>
          <SettlementHistory
            loading={loading}
            history={hist}
            sr={sr}
            jr={jr}
            decimals={dec}
            unavailable={
              dataUnavailable || !!ov.data?.issues.includes('history')
            }
          />
          <section className="card market-risk">
            <div className="desk-heading">
              <div>
                <span className="eyebrow">UNDERSTAND THE TRADE-OFF</span>
                <h2>Priority has a price.</h2>
              </div>
            </div>
            <RiskExplainer selected={selected} />
            <p className="market-disclosure">
              Senior has priority, not a capital guarantee. Junior absorbs
              losses first and receives residual yield. Both layers can lose
              value.
            </p>
          </section>
        </div>
        <aside className="investment-column">
          <div className="ticket-context">
            <span className="spark" /> YOUR {selected.toUpperCase()} POSITION{' '}
            <span>SEPOLIA</span>
          </div>
          <Ticket
            loading={loading}
            product={p}
            last={last}
            type={selected}
            onTypeChange={setSelected}
            onBusyChange={setTransactionBusy}
          />
          <div className="ticket-journey">
            <span>
              <b>01</b> Request
            </span>
            <span>
              <b>02</b> Settle
            </span>
            <span>
              <b>03</b> Claim
            </span>
            <p>
              Approval lets the vault use your tokens. A request enters
              settlement. Claim afterwards to receive shares or USDC.
            </p>
          </div>
        </aside>
      </div>
      <a href="#invest" className="mobile-position-jump">
        Invest in {selected}
        <Icon name="arrow" size={15} />
      </a>
    </div>
  )
}
