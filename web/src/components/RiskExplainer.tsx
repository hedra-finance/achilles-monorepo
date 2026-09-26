'use client'
import { useState } from 'react'
import { Icon } from './Icon'
import type { RiskLayer } from './YieldFlow'
import { lossScenario } from '@/lib/risk-scenario'

export function RiskExplainer({ selected }: { selected: RiskLayer }) {
  const [view, setView] = useState<'yield' | 'loss'>('yield')
  const [loss, setLoss] = useState(10)
  const scenario = lossScenario(loss)
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
      {view === 'loss' && (
        <div className="loss-illustration content-enter">
          <div className="loss-scenario-heading">
            <strong>Try a $100 portfolio</strong>
            <span>Initial capital: $80 Senior / $20 Junior</span>
          </div>
          <label className="loss-slider-label">
            <span>
              Portfolio loss <strong>${loss}</strong>
            </span>
            <input
              type="range"
              min="0"
              max="100"
              step="1"
              value={loss}
              aria-label="Illustrative portfolio loss in dollars"
              aria-valuetext={`$${loss} loss from a $100 portfolio`}
              onChange={(event) => setLoss(Number(event.target.value))}
            />
          </label>
          <div className="loss-presets" role="group" aria-label="Loss examples">
            {[0, 10, 20, 25].map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={loss === value}
                onClick={() => setLoss(value)}
              >
                ${value} loss
              </button>
            ))}
          </div>
          <div className="loss-outcomes" aria-live="polite" aria-atomic="true">
            {(['senior', 'junior'] as const).map((layer) => (
              <div className={`loss-outcome ${layer}`} key={layer}>
                <div>
                  <span>
                    {layer === 'senior' ? 'Senior' : 'Junior'} remaining
                  </span>
                  <strong>${scenario[layer]}</strong>
                </div>
                <div className="loss-bar" aria-hidden="true">
                  <span
                    style={{
                      width: `${(scenario[layer] / (layer === 'senior' ? 80 : 20)) * 100}%`
                    }}
                  />
                </div>
                <small>
                  $
                  {layer === 'senior'
                    ? scenario.seniorLoss
                    : scenario.juniorLoss}{' '}
                  loss absorbed
                </small>
              </div>
            ))}
          </div>
          <p className="risk-explainer-note">
            {loss > 20
              ? 'The $20 Junior buffer is exhausted. Further losses reduce Senior capital.'
              : loss === 20
                ? 'Junior is fully depleted. Any further loss reaches Senior.'
                : 'Junior absorbs losses first, up to its $20 capital in this example.'}
          </p>
          <small className="loss-disclosure">
            Illustration only, not the current capital split or a forecast. Fees
            and yield accrual are omitted.
          </small>
        </div>
      )}
      <div
        key={view}
        className="waterfall-order content-enter"
        aria-live="polite"
      >
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
