'use client'
import { useState } from 'react'
import { Icon } from './Icon'
import type { RiskLayer } from './YieldFlow'

export function RiskExplainer({ selected }: { selected: RiskLayer }) {
  const [view, setView] = useState<'yield' | 'loss'>('yield')
  const layers: RiskLayer[] =
    view === 'yield' ? ['Senior', 'Junior'] : ['Junior', 'Senior']
  return (
    <div className="risk-explainer">
      <div className="section-heading">
        <h3>Understand the order.</h3>
        <div
          className="risk-view"
          role="group"
          aria-label="Distribution scenario"
        >
          <button
            aria-pressed={view === 'yield'}
            onClick={() => setView('yield')}
          >
            Yield
          </button>
          <button
            aria-pressed={view === 'loss'}
            onClick={() => setView('loss')}
          >
            Loss
          </button>
        </div>
      </div>
      <div className="waterfall-order" aria-live="polite">
        {layers.map((layer, i) => (
          <div
            key={layer}
            className={
              'waterfall-step ' +
              layer.toLowerCase() +
              (selected === layer ? ' yours' : '')
            }
          >
            <span className="waterfall-number">0{i + 1}</span>
            <Icon name={layer === 'Senior' ? 'shield' : 'chart'} size={20} />
            <div>
              <strong>{layer}</strong>
              <small>
                {view === 'yield'
                  ? i === 0
                    ? 'Receives yield up to its target first'
                    : 'Receives the remaining yield'
                  : i === 0
                    ? 'Absorbs the first losses'
                    : 'Takes losses if Junior is depleted'}
              </small>
            </div>
            {selected === layer && (
              <span className="your-layer">Your layer</span>
            )}
          </div>
        ))}
      </div>
      <p className="risk-explainer-note">
        {view === 'yield'
          ? 'Priority is an allocation rule, not a guaranteed return. Available yield depends on strategy performance.'
          : 'Senior has lower relative risk, not zero risk. Losses can affect both tranches.'}
      </p>
    </div>
  )
}
