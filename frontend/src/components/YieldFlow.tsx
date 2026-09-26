'use client'
import { AmbientMotion } from './Motion'
import { LogoSurface } from './LogoSurface'
import { Icon } from './Icon'
import { PRODUCT } from '@/lib/product'

export type RiskLayer = 'Senior' | 'Junior'
const SOURCES = [
  {
    name: 'Tokenized stocks',
    detail: 'Robinhood testnet',
    icon: 'chart',
    available: true,
    weight: PRODUCT.weights[PRODUCT.robinhood.chainId] / 100
  },
  {
    name: 'Stablecoin liquidity',
    detail: 'USDC / USDT · Sepolia',
    icon: 'coins',
    available: true,
    weight: PRODUCT.weights[PRODUCT.sepolia.chainId] / 100
  },
  {
    name: 'DeFi lending',
    detail: 'Money markets',
    icon: 'wallet',
    available: false
  },
  {
    name: 'Treasuries & bonds',
    detail: 'Fixed-income strategies',
    icon: 'shield',
    available: false
  },
  {
    name: 'Real-world assets',
    detail: 'Credit & real estate',
    icon: 'globe',
    available: false
  },
  {
    name: 'Custom strategies',
    detail: 'An open design space',
    icon: 'layers',
    available: false
  }
] as const

export function YieldFlow({
  selected,
  disabled,
  onSelect
}: {
  selected: RiskLayer
  disabled: boolean
  onSelect: (layer: RiskLayer) => void
}) {
  return (
    <AmbientMotion>
      <div className="yield-flow">
        <svg
          className="flow-wires"
          viewBox="0 0 1200 440"
          preserveAspectRatio="none"
          fill="none"
          aria-hidden="true"
        >
          <defs>
            <linearGradient id="wire-color">
              <stop stopColor="#1757bb" />
              <stop offset=".55" stopColor="#6ae0ff" />
              <stop offset="1" stopColor="#1468ff" />
            </linearGradient>
            <filter id="wire-glow">
              <feGaussianBlur stdDeviation="3" />
            </filter>
          </defs>
          {[65, 133, 201, 269, 337, 405].map((y, i) => (
            <g key={y} opacity={i < 2 ? 1 : 0.23}>
              <path
                d={`M 263 ${y} C 380 ${y}, 360 224, 495 224`}
                stroke="url(#wire-color)"
                strokeWidth="5"
                filter="url(#wire-glow)"
              />
              <path
                d={`M 263 ${y} C 380 ${y}, 360 224, 495 224`}
                stroke="url(#wire-color)"
                strokeWidth={i < 2 ? 1.6 : 1}
                strokeDasharray={i < 2 ? undefined : '4 6'}
              />
              {i < 2 && (
                <path
                  className="flow-current"
                  pathLength="100"
                  d={`M 263 ${y} C 380 ${y}, 360 224, 495 224`}
                  stroke="#b9efff"
                  strokeWidth="2"
                  style={{ animationDelay: `${i * -1.6}s` }}
                />
              )}
            </g>
          ))}
          {[145, 313].map((y) => (
            <g key={y}>
              <path
                d={`M 690 224 C 810 224, 755 ${y}, 895 ${y}`}
                stroke="#1588ff"
                strokeWidth="8"
                filter="url(#wire-glow)"
              />
              <path
                d={`M 690 224 C 810 224, 755 ${y}, 895 ${y}`}
                stroke="url(#wire-color)"
                strokeWidth="2"
              />
              <path
                className="flow-current"
                pathLength="100"
                d={`M 690 224 C 810 224, 755 ${y}, 895 ${y}`}
                stroke="#b9efff"
                strokeWidth="2"
              />
            </g>
          ))}
        </svg>
        <div className="flow-sources">
          <div className="flow-caption">
            <span>01</span> YIELD SOURCES
          </div>
          <div className="source-nodes">
            {SOURCES.map((source) => (
              <a
                key={source.name}
                className={
                  'source-node' + (!source.available ? ' planned' : '')
                }
                href={source.available ? '#strategy' : '#vision'}
              >
                <span className="node-icon">
                  <Icon name={source.icon} size={20} />
                </span>
                <span className="node-copy">
                  <strong>{source.name}</strong>
                  <small>{source.detail}</small>
                </span>
                <span className="node-tag">
                  {source.available ? `${source.weight}%` : 'VISION'}
                </span>
              </a>
            ))}
          </div>
          <p className="flow-footnote">Weights are configured targets.</p>
          <a className="flow-vision-link" href="#vision">
            Explore four more source categories in our vision →
          </a>
        </div>
        <div className="flow-engine">
          <span className="flow-caption">
            <span>02</span> ONE STRUCTURING LAYER
          </span>
          <LogoSurface />
          <p>
            Many sources.
            <br />
            <strong>A risk profile that fits you.</strong>
          </p>
          <span className="engine-label">
            <Icon name="layers" size={13} /> Cross-chain settlement
          </span>
        </div>
        <div className="flow-layers">
          <span className="flow-caption">
            <span>03</span> YOUR CHOICE OF RISK
          </span>
          {(['Senior', 'Junior'] as const).map((layer) => (
            <button
              key={layer}
              disabled={disabled}
              aria-pressed={selected === layer}
              className={
                'glass-layer ' +
                layer.toLowerCase() +
                (selected === layer ? ' selected' : '')
              }
              onClick={() => onSelect(layer)}
            >
              <span className="glass-face">
                <span className="glass-icon">
                  <Icon
                    name={layer === 'Senior' ? 'shield' : 'chart'}
                    size={32}
                  />
                </span>
                <span className="glass-copy">
                  <small>
                    {layer === 'Senior' ? 'PRIORITY YIELD' : 'RESIDUAL UPSIDE'}
                  </small>
                  <strong>{layer} Tranche</strong>
                  <span>
                    {layer === 'Senior'
                      ? 'First in yield. Last in loss.'
                      : 'First loss. Higher upside potential.'}
                  </span>
                </span>
                <span className="glass-action">
                  {selected === layer ? (
                    <>
                      <Icon name="check" size={14} /> Selected
                    </>
                  ) : (
                    <>
                      Explore layer <Icon name="arrow" size={14} />
                    </>
                  )}
                </span>
              </span>
            </button>
          ))}
          <p className="flow-footnote">
            Both layers carry risk of capital loss.
          </p>
        </div>
      </div>
    </AmbientMotion>
  )
}
