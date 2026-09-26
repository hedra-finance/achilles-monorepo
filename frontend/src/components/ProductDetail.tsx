'use client'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useWalletAccount } from '@/hooks/wallet'
import { useProduct, useOverview, useAccountData } from '@/hooks/data'
import { NavChart } from './NavChart'
import { PoolActivity } from './PoolActivity'
import { Ticket } from './Ticket'
import { Allocation } from './Allocation'
import { SettlementHistory } from './SettlementHistory'
import { Icon } from './Icon'
import { QueryNotice } from './State'
import type { RiskLayer } from './YieldFlow'
import { RiskExplainer } from './RiskExplainer'
import { HelpTip } from './HelpTip'
import { ScrollHint } from './ScrollHint'
import { fmt, pct, displayYieldPercent } from '@/lib/math'
import { hubConfigured } from '@/lib/chains'
import { LoadingValue } from './Skeleton'
import { PRODUCT } from '@/lib/product'
import type { TicketMode } from '@/lib/position-actions'

const VIEWS = [
  ['assets', 'Assets & prices'],
  ['performance', 'Performance'],
  ['settlements', 'Settlements'],
  ['activity', 'Pool activity'],
  ['risk', 'Risk & process']
] as const
type View = (typeof VIEWS)[number][0]
const HASH_VIEWS: Record<string, View> = {
  strategy: 'assets',
  performance: 'performance',
  settlements: 'settlements',
  'pool-activity': 'activity',
  'how-it-works': 'risk'
}

export function ProductDetail({
  initialLayer = 'Senior',
  initialMode = 'invest'
}: {
  initialLayer?: RiskLayer
  initialMode?: TicketMode
}) {
  const product = useProduct(),
    ov = useOverview(),
    acct = useAccountData()
  const { address } = useWalletAccount()
  const [selected, setSelected] = useState<RiskLayer>(initialLayer)
  const [view, setView] = useState<View>('assets')
  const [mobilePane, setMobilePane] = useState<'research' | 'trade'>('research')
  const [transactionBusy, setTransactionBusy] = useState(false)
  const researchScroll = useRef<HTMLDivElement>(null)
  const ticketScroll = useRef<HTMLDivElement>(null)
  const [actionSlot, setActionSlot] = useState<HTMLDivElement | null>(null)
  useEffect(() => {
    const sync = () => {
      const hash = location.hash.slice(1)
      if (HASH_VIEWS[hash]) {
        setView(HASH_VIEWS[hash])
        setMobilePane('research')
      }
      if (hash === 'invest') setMobilePane('trade')
    }
    sync()
    window.addEventListener('hashchange', sync)
    return () => window.removeEventListener('hashchange', sync)
  }, [])
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
  const yieldFor = (i: number) =>
    displayYieldPercent(
      hist.map((h) => ({
        at: h.at,
        price: h.sharePrices[i] == null ? null : Number(h.sharePrices[i]) / 1e18
      }))
    )
  const jrY = yieldFor(jr),
    selectedYield = yieldFor(index)
  const last = ov.data?.last ?? null
  const sharePrice = last?.sharePrices[index]
  const position = acct.data?.positions.find((pos) => pos.index === index)
  const dec = p?.decimals ?? 6
  const positionValue =
    position && sharePrice != null
      ? (position.shares * sharePrice) / 10n ** 18n
      : null
  const dataUnavailable = !hubConfigured || product.isError || ov.isError
  const loading = hubConfigured && (product.isPending || (!!p && ov.isPending))
  function chooseView(next: View) {
    setView(next)
    const url = new URL(location.href)
    url.hash =
      Object.keys(HASH_VIEWS).find((key) => HASH_VIEWS[key] === next) ??
      'strategy'
    history.replaceState(history.state, '', url)
  }
  function navigateTabs(event: KeyboardEvent<HTMLButtonElement>, i: number) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? VIEWS.length - 1
          : (i + (event.key === 'ArrowRight' ? 1 : -1) + VIEWS.length) %
            VIEWS.length
    chooseView(VIEWS[next][0])
    document.getElementById(`desk-tab-${VIEWS[next][0]}`)?.focus()
  }
  return (
    <div
      className="market-experience trading-desk"
      data-mobile-pane={mobilePane}
    >
      <header className="desk-topbar">
        <div className="desk-product-name">
          <span className="desk-product-symbol">
            <Icon name="layers" size={23} />
          </span>
          <div>
            <h1>Stocks & Stable LP</h1>
            <p>
              {PRODUCT.robinhood.basket.length} technology stocks · USDC / USDT
              liquidity
            </p>
          </div>
        </div>
        <span className="desk-network">
          <span className="status-dot amber" /> Sepolia testnet
        </span>
      </header>
      <div className="desk-stats" aria-label="Strategy snapshot">
        <div>
          <span>
            Strategy NAV{' '}
            <HelpTip label="About strategy NAV">
              Total portfolio value at the latest finalized settlement. Current
              pool quotes may differ.
            </HelpTip>
          </span>
          <strong>
            <LoadingValue loading={loading}>
              {fmt(last?.productNav, dec)}
            </LoadingValue>
            <small>USDC</small>
          </strong>
        </div>
        <div>
          <span>{selected} share price</span>
          <strong>
            <LoadingValue loading={loading}>
              {fmt(sharePrice, 18, 4)}
            </LoadingValue>
            <small>USDC</small>
          </strong>
        </div>
        <div>
          <span>Your {selected} position</span>
          <strong>
            {fmt(positionValue, dec)}
            <small>{address ? 'USDC' : 'Wallet not connected'}</small>
          </strong>
        </div>
        <div>
          <span>Last settlement</span>
          <strong>
            {last ? `#${last.id}` : '—'}
            <small>
              {last?.at
                ? last.at.toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit'
                  })
                : 'Awaiting data'}
            </small>
          </strong>
        </div>
      </div>
      {dataUnavailable || ov.data?.issues.length ? (
        <QueryNotice
          title={
            !hubConfigured
              ? 'Settlement connection unavailable'
              : 'Some settlement data is unavailable'
          }
          retry={
            hubConfigured
              ? () => {
                  void product.refetch()
                  void ov.refetch()
                }
              : undefined
          }
          busy={product.isFetching || ov.isFetching}
        >
          Available source prices remain visible. Missing values are shown as a
          dash.
        </QueryNotice>
      ) : null}
      <div
        className="desk-mobile-switch"
        role="group"
        aria-label="Workspace panel"
      >
        <button
          aria-pressed={mobilePane === 'research'}
          onClick={() => setMobilePane('research')}
        >
          Market
        </button>
        <button
          aria-pressed={mobilePane === 'trade'}
          onClick={() => setMobilePane('trade')}
        >
          Trade {selected} <Icon name="arrow" size={14} />
        </button>
      </div>
      <div className="desk-grid" data-mobile-pane={mobilePane}>
        <section className="desk-research" aria-label="Strategy research">
          <div className="desk-tabs" role="tablist" aria-label="Strategy data">
            {VIEWS.map(([key, label], i) => (
              <button
                key={key}
                id={`desk-tab-${key}`}
                role="tab"
                aria-selected={view === key}
                aria-controls="desk-panel"
                tabIndex={view === key ? 0 : -1}
                onKeyDown={(e) => navigateTabs(e, i)}
                onClick={() => chooseView(key)}
              >
                {label}
              </button>
            ))}
          </div>
          <div
            ref={researchScroll}
            className="desk-panel"
            id="desk-panel"
            role="tabpanel"
            aria-labelledby={`desk-tab-${view}`}
            tabIndex={0}
            key={view}
          >
            {view === 'assets' && (
              <Allocation
                compact
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
            )}
            {view === 'performance' && (
              <section id="performance" className="desk-performance">
                <div className="desk-heading">
                  <div>
                    <span className="eyebrow">RECORDED SHARE PRICES</span>
                    <h2>{selected} performance</h2>
                  </div>
                  <span className={`pill ${selected.toLowerCase()}`}>
                    {selected}
                  </span>
                </div>
                <p className="performance-return">
                  <strong>{pct(selectedYield.percent)}</strong>
                  {selectedYield.annualized
                    ? ' realized APR'
                    : ' period return'}{' '}
                  <HelpTip label="About recorded performance">
                    Historical share-price changes, not a forecast. Short
                    histories are not annualized.
                  </HelpTip>
                </p>
                <NavChart
                  loading={loading}
                  history={hist}
                  sr={sr}
                  jr={jr}
                  selected={selected}
                />
              </section>
            )}
            {view === 'settlements' && (
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
            )}
            {view === 'activity' && <PoolActivity />}
            {view === 'risk' && (
              <section className="desk-risk" id="how-it-works">
                <div className="desk-heading">
                  <div>
                    <span className="eyebrow">KNOW YOUR EXPOSURE</span>
                    <h2>Priority has a price.</h2>
                  </div>
                </div>
                <RiskExplainer selected={selected} />
                <p className="desk-risk-note">
                  Senior has priority, not a capital guarantee. Junior takes the
                  first loss. Both layers can lose value.
                </p>
                <details className="desk-disclosure">
                  <summary>
                    How requests become claims <Icon name="chevron" size={14} />
                  </summary>
                  <ol className="compact-steps">
                    <li>
                      <b>Request</b> Submit on Sepolia.
                    </li>
                    <li>
                      <b>Settle</b> Requests are batched; recorded valuations
                      determine shares and payout.
                    </li>
                    <li>
                      <b>Claim</b> Receive shares or USDC with a separate wallet
                      transaction.
                    </li>
                  </ol>
                </details>
              </section>
            )}
          </div>
          <ScrollHint target={researchScroll} revision={view} />
        </section>
        <aside className="desk-trade" aria-label="Trade panel">
          <div className="desk-layer-heading">
            <span>YOUR RISK LAYER</span>
            <HelpTip label="Compare risk layers">
              Senior is paid first up to its target yield. Junior receives
              residual yield and absorbs losses first. Switching updates the
              ticket and metrics.
            </HelpTip>
          </div>
          <div
            className="desk-layer-switch"
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
                <span>
                  <Icon
                    name={layer === 'Senior' ? 'shield' : 'chart'}
                    size={16}
                  />
                  {layer}
                </span>
                <strong>
                  <LoadingValue loading={loading}>
                    {layer === 'Senior' ? pct(srApr) : pct(jrY.percent)}
                  </LoadingValue>
                </strong>
                <small>
                  {layer === 'Senior'
                    ? 'Target APR · priority'
                    : jrY.annualized
                      ? 'Realized APR · first loss'
                      : 'Period return · first loss'}
                </small>
              </button>
            ))}
          </div>
          <div className="desk-ticket-viewport">
            <div
              className="desk-ticket-scroll"
              ref={ticketScroll}
              tabIndex={0}
              role="region"
              aria-label="Trade form"
            >
              <Ticket
                compact
                actionSlot={actionSlot}
                initialMode={initialMode}
                loading={loading}
                product={p}
                last={last}
                type={selected}
                onTypeChange={setSelected}
                onBusyChange={setTransactionBusy}
              />
            </div>
            <ScrollHint target={ticketScroll} />
          </div>
          <div className="desk-trade-actions" ref={setActionSlot} />
          <p className="desk-trade-footnote">
            <Icon name="clock" size={12} /> Request → settle → claim. Capital is
            at risk.
          </p>
        </aside>
      </div>
    </div>
  )
}
