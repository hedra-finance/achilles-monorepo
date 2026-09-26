'use client'
import {
  JUNIOR_TESTNET_OVERRIDE,
  JUNIOR_TESTNET_LABEL
} from '@/lib/junior-display'
import { useState } from 'react'
import { MotionLink as Link } from '@/components/MotionLink'
import Image from 'next/image'
import { PRODUCT } from '@/lib/product'
import { fmt, pct } from '@/lib/math'
import { useStrategySnapshot } from '@/hooks/strategy'
import { YieldFlow, type RiskLayer } from './YieldFlow'
import { RiskExplainer } from './RiskExplainer'
import { StockLogo } from './StockLogo'
import { MotionToggle } from './Motion'
import { LoadingValue } from './Skeleton'
import { FaqItem } from './FaqItem'
import { Icon } from './Icon'

const QUESTIONS = [
  [
    'What does Achilles do?',
    'Achilles separates the sources of yield from the way you take risk. The current testnet product combines a technology stock basket with stablecoin liquidity, then allocates the economics between Senior and Junior tranches.'
  ],
  [
    'Is Senior principal protected?',
    'No. Senior receives available yield first, up to its target, and Junior absorbs losses first. If losses exceed the Junior layer, Senior capital can also lose value.'
  ],
  [
    'What does Junior receive?',
    'Junior receives the remaining yield after the Senior allocation and absorbs the first losses. Its return depends on strategy performance and the size of each tranche; it is not a fixed rate.'
  ],
  [
    'Are these live stock-market prices?',
    'The app displays testnet token prices from the configured pools and valuation records from finalized settlements. They are not live exchange quotes or a claim that the strategy holds real-world company shares.'
  ],
  [
    'What do I need to invest?',
    'Connect a wallet on Sepolia. Senior access uses World ID; Junior access uses a team invite code. Fund your wallet with test ETH and the test USDC faucet. The product page checks each prerequisite before submission.'
  ],
  [
    'Why does Senior use World ID?',
    'Senior registration links one verified human to one wallet, reducing duplicate registrations across wallets. The proof does not establish legal identity, financial suitability, or a deposit cap. Junior offers a separate invite-based route with first-loss exposure; it is a different risk choice.'
  ],
  [
    'Can I withdraw immediately?',
    'Redemptions are asynchronous. Request a redemption, wait for settlement, then claim the available USDC. Deposits follow the same request, settlement and claim cycle.'
  ]
] as const

export function Landing() {
  const [selected, setSelected] = useState<RiskLayer>('Senior')
  const s = useStrategySnapshot()
  return (
    <div className="landing-page">
      <section className="ir-hero landing-hero" aria-labelledby="hero-title">
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
            <span className="spark" /> ACHILLES / THE YIELD STRUCTURING PROTOCOL
          </span>
          <h1 id="hero-title">
            Structure any yield.
            <br />
            <span>On any chain.</span>
          </h1>
          <p>
            Different sources. One capital structure.
            <br />
            Choose priority yield or first-loss exposure.
          </p>
          <div className="landing-actions">
            <Link className="btn primary" href="/products">
              Explore products <Icon name="arrow" size={16} />
            </Link>
            <a className="btn landing-secondary" href="#strategy">
              See what’s underneath
            </a>
          </div>
        </div>
        <YieldFlow
          selected={selected}
          disabled={false}
          onSelect={setSelected}
        />
        <div className="hero-continue">
          <MotionToggle />
          <span>
            <span className="status-dot amber" /> SEPOLIA TESTNET <i /> USDC
            SETTLEMENT <i /> TWO RISK LAYERS
          </span>
        </div>
      </section>

      <section
        id="strategy"
        data-reveal
        className="landing-section landing-underlying"
        aria-labelledby="underlying-title"
      >
        <div className="landing-section-head">
          <div>
            <span className="eyebrow">01 / THE UNDERLYING ASSETS</span>
            <h2 id="underlying-title">
              Know where your
              <br />
              <span>capital goes.</span>
            </h2>
          </div>
          <p>
            Our first testnet product brings together technology stocks and
            stablecoin liquidity. Same portfolio. Two ways to participate.
          </p>
        </div>
        <div className="underlying-grid">
          <article className="underlying-card">
            <div className="underlying-top">
              <Icon name="chart" size={26} />
              <span>ROBINHOOD TESTNET</span>
              <b>
                {PRODUCT.weights[PRODUCT.robinhood.chainId] / 100}%
                <small>capital target</small>
              </b>
            </div>
            <h3>Technology stock basket</h3>
            <p>
              {PRODUCT.robinhood.basket.length} configured stock tokens, with
              every holding and pool price visible in the app.
            </p>
            <div className="landing-stock-grid">
              {PRODUCT.robinhood.basket.map((b) => (
                <span key={b.symbol}>
                  <StockLogo ticker={b.symbol} />
                  <strong>{b.symbol}</strong>
                </span>
              ))}
            </div>
          </article>
          <article className="underlying-card liquidity">
            <div className="underlying-top">
              <Icon name="coins" size={26} />
              <span>ETHEREUM SEPOLIA</span>
              <b>
                {PRODUCT.weights[PRODUCT.sepolia.chainId] / 100}%
                <small>capital target</small>
              </b>
            </div>
            <h3>Stablecoin liquidity</h3>
            <p>
              A Uniswap V2 USDC / USDT pair on Sepolia. Trading fees contribute
              to the strategy alongside stock exposure.
            </p>
            <div
              className="stablecoin-art"
              aria-label="USDC and USDT liquidity pair"
            >
              <span>USDC</span>
              <i />
              <span>USDT</span>
            </div>
          </article>
        </div>
        <p className="landing-note">
          Configured allocation targets, not current holdings. The testnet
          assets and pool prices are experimental.
        </p>
      </section>

      <section
        id="tranches"
        data-reveal
        className="landing-section landing-tranches"
        aria-labelledby="tranches-title"
      >
        <div className="landing-section-head">
          <div>
            <span className="eyebrow">02 / THE CAPITAL STRUCTURE</span>
            <h2 id="tranches-title">
              One strategy.
              <br />
              <span>Choose your side.</span>
            </h2>
          </div>
          <p>
            Priority comes with a trade-off. Senior receives yield first; Junior
            takes the first losses and the remaining upside.
          </p>
        </div>
        <div className="landing-tranche-grid">
          {(['Senior', 'Junior'] as const).map((layer) => (
            <button
              key={layer}
              className={`landing-tranche ${layer.toLowerCase()} ${selected === layer ? 'selected' : ''}`}
              aria-pressed={selected === layer}
              onClick={() => setSelected(layer)}
            >
              <div>
                <Icon
                  name={layer === 'Senior' ? 'shield' : 'chart'}
                  size={26}
                />
                <span>
                  {layer === 'Senior' ? 'PRIORITY YIELD' : 'FIRST-LOSS CAPITAL'}
                </span>
                <span className="radio-indicator" />
              </div>
              <h3>{layer}</h3>
              <p>
                {layer === 'Senior'
                  ? 'Receive available yield first, up to the target rate. Junior capital absorbs losses before your layer.'
                  : 'Receive the remaining yield after Senior. In exchange, your capital absorbs the strategy’s first losses.'}
              </p>
              <div className="landing-rate">
                <strong>
                  <LoadingValue loading={s.loading}>
                    {layer === 'Senior'
                      ? pct(s.seniorApr)
                      : pct(s.junior.percent)}
                  </LoadingValue>
                </strong>
                <span>
                  {layer === 'Senior'
                    ? 'Target APR'
                    : JUNIOR_TESTNET_OVERRIDE
                      ? JUNIOR_TESTNET_LABEL
                      : s.junior.annualized
                        ? 'Realized APR'
                        : 'Period return'}
                </span>
              </div>
              <span className="landing-layer-action">
                {selected === layer ? 'Selected layer' : `Explore ${layer}`}{' '}
                <Icon name={selected === layer ? 'check' : 'arrow'} size={15} />
              </span>
            </button>
          ))}
        </div>
        <div className="landing-waterfall">
          <div>
            <span className="eyebrow">THE WATERFALL</span>
            <h3>See who goes first.</h3>
            <p>
              Switch between yield and loss to understand the order. Neither
              layer guarantees capital or returns.
            </p>
          </div>
          <RiskExplainer selected={selected} />
        </div>
      </section>

      <section
        id="access"
        data-reveal
        className="landing-section landing-access"
        aria-labelledby="access-title"
      >
        <div className="landing-section-head">
          <div>
            <span className="eyebrow">03 / YOUR WAY IN</span>
            <h2 id="access-title">
              From discovery
              <br />
              <span>to your first request.</span>
            </h2>
          </div>
          <p>
            Browse the strategy before connecting. When you are ready, the
            investment ticket guides you through each step.
          </p>
        </div>
        <ol className="access-roadmap">
          {[
            ['wallet', 'Connect', 'Connect your wallet and select Sepolia.'],
            [
              'shield',
              'Get access',
              'Verify with World ID for Senior, or use a team invite for Junior.'
            ],
            [
              'coins',
              'Fund',
              'Get test ETH and top up test USDC from the investment ticket.'
            ],
            [
              'check',
              'Review & request',
              'Choose a tranche, enter an amount and review before signing.'
            ]
          ].map(([icon, title, text], i) => (
            <li key={title}>
              <span className="roadmap-number">0{i + 1}</span>
              <Icon
                name={icon as 'wallet' | 'shield' | 'coins' | 'check'}
                size={24}
              />
              <h3>{title}</h3>
              <p>{text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section
        id="settlement"
        data-reveal
        className="landing-section landing-settlement"
        aria-labelledby="settlement-title"
      >
        <div className="landing-section-head">
          <div>
            <span className="eyebrow">04 / FOLLOW YOUR CAPITAL</span>
            <h2 id="settlement-title">
              Every request.
              <br />
              <span>A visible path.</span>
            </h2>
          </div>
          <p>
            Track a request across chains, inspect finalized prices, then claim
            the resulting shares or USDC.
          </p>
        </div>
        <div className="landing-settlement-layout">
          <ol className="settlement-stages">
            {[
              [
                'Request',
                'Submit on Sepolia. Your wallet confirms the transaction.'
              ],
              [
                'Bridge & batch',
                'The request reaches the hub and joins a settlement round.'
              ],
              [
                'Value & settle',
                'Asset valuations feed the tranche waterfall and share prices.'
              ],
              ['Claim', 'When ready, claim shares or USDC from your portfolio.']
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
          <div className="landing-record">
            <span className="eyebrow">
              <span className="status-dot amber" /> FROM THE SETTLEMENT HUB
            </span>
            <h3>Recorded on-chain.</h3>
            <dl>
              <div>
                <dt>Strategy NAV</dt>
                <dd>
                  <LoadingValue loading={s.loading}>
                    {fmt(s.last?.productNav, s.decimals)}
                  </LoadingValue>{' '}
                  <small>USDC</small>
                </dd>
              </div>
              <div>
                <dt>Senior share price</dt>
                <dd>
                  <LoadingValue loading={s.loading}>
                    {fmt(s.seniorPrice, 18, 6)}
                  </LoadingValue>{' '}
                  <small>USDC</small>
                </dd>
              </div>
              <div>
                <dt>Latest finalized round</dt>
                <dd>
                  <LoadingValue loading={s.loading}>
                    {s.last ? `#${s.last.id}` : '—'}
                  </LoadingValue>
                </dd>
              </div>
            </dl>
            <p>
              {s.issue
                ? 'Some data is currently unavailable.'
                : s.loading
                  ? 'Loading the latest recorded values…'
                  : 'Values from finalized settlement records.'}{' '}
              No instant withdrawal: request, settle, then claim.
            </p>
          </div>
        </div>
      </section>

      <section
        id="vision"
        data-reveal
        className="landing-section landing-vision"
        aria-labelledby="vision-title"
      >
        <span className="eyebrow">THE VISION / BEYOND TODAY’S STRATEGY</span>
        <h2 id="vision-title">
          A wider world of yield.
          <br />
          <span>The same choice of risk.</span>
        </h2>
        <div>
          {[
            'DeFi lending',
            'Treasuries & bonds',
            'Real-world assets',
            'Custom strategies'
          ].map((title) => (
            <span key={title}>
              <Icon name="layers" size={18} />
              <strong>{title}</strong>
              <small>Planned</small>
            </span>
          ))}
        </div>
        <p>
          These categories describe the product vision. Today’s testnet product
          is the stock basket and stablecoin liquidity strategy.
        </p>
      </section>

      <section
        id="faq"
        data-reveal
        className="landing-section landing-faq"
        aria-labelledby="faq-title"
      >
        <div>
          <span className="eyebrow">A FEW THINGS TO KNOW</span>
          <h2 id="faq-title">
            Before you
            <br />
            <span>choose your layer.</span>
          </h2>
        </div>
        <div>
          {QUESTIONS.map(([question, answer]) => (
            <FaqItem key={question} question={question} answer={answer} />
          ))}
        </div>
      </section>
      <section data-reveal className="landing-final">
        <span className="eyebrow">KNOW THE RISK. CHOOSE YOUR LAYER.</span>
        <h2>
          Your capital.
          <br />
          <span>Your place in the structure.</span>
        </h2>
        <p>Start with the assets. Find the exposure that fits you.</p>
        <div className="landing-actions">
          <Link className="btn primary" href="/products">
            Launch app <Icon name="arrow" size={16} />
          </Link>
        </div>
        <small>
          Experimental protocol · Sepolia testnet · Capital and returns are not
          guaranteed.
        </small>
      </section>
    </div>
  )
}
