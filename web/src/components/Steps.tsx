import type { TxStep } from '@/lib/reads'
import { txUrl, chainLabel } from '@/lib/chains'
import { short } from '@/lib/math'

export function Steps({ steps }: { steps: TxStep[] }) {
  return (
    <ul className="steps">
      {steps.map((s, i) => {
        const url = s.txHash && s.chainId != null ? txUrl(s.chainId, s.txHash) : null
        return (
          <li key={i} className={s.failed ? 'failed' : s.done ? 'done' : ''}>
            <span className="dot" />
            <span>{s.label}{s.failed ? ' (bridge reverted, retrying)' : ''}</span>
            {s.txHash && (url
              ? <a href={url} target="_blank" rel="noreferrer">{short(s.txHash)}</a>
              : <span className="mono">{short(s.txHash)}</span>)}
            {s.chainId != null && <span className="muted" style={{ fontSize: 12 }}>{chainLabel(s.chainId)}</span>}
            {s.at && <span className="muted" style={{ fontSize: 12 }}>{s.at.toLocaleString()}</span>}
          </li>
        )
      })}
    </ul>
  )
}
