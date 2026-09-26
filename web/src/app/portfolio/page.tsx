'use client'
import { PageMotion } from '@/components/Motion'
import { DataSkeleton } from '@/components/Skeleton'
import { MotionLink as Link } from '@/components/MotionLink'
import { WalletEmpty, QueryNotice, PageHeading } from '@/components/State'
import { hubConfigured } from '@/lib/chains'
import { useAccount } from 'wagmi'
import {
  useProduct,
  useOverview,
  useAccountData,
  useReceives
} from '@/hooks/data'
import { chainLabel, txUrl } from '@/lib/chains'
import { fmt, short } from '@/lib/math'
import { PRODUCT } from '@/lib/product'
import {
  hasPosition,
  positionActions,
  ticketHref
} from '@/lib/position-actions'

export default function PortfolioPage() {
  return (
    <PageMotion>
      <PortfolioContent />
    </PageMotion>
  )
}
function PortfolioContent() {
  const { address } = useAccount()
  const product = useProduct()
  const p = product.data
  const ov = useOverview()
  const acct = useAccountData()
  const recv = useReceives(address)
  const heading = (
    <PageHeading
      eyebrow="YOUR ACCOUNT"
      title="Portfolio"
      description="Your capital, positions, and available claims — together."
    />
  )
  if (!address)
    return (
      <>
        {heading}
        <WalletEmpty />
      </>
    )
  if (!hubConfigured)
    return (
      <>
        {heading}
        <QueryNotice title="Live positions are not connected yet">
          The settlement connection is being configured. Your wallet is
          connected; balances will appear when the connection is ready.
        </QueryNotice>
      </>
    )
  if (product.isError || acct.isError)
    return (
      <>
        {heading}
        <QueryNotice
          title="Unable to load your positions"
          retry={() => {
            void product.refetch()
            void acct.refetch()
          }}
        >
          Your funds are unchanged. Retry the network connection.
        </QueryNotice>
      </>
    )
  if (!p || !acct.data)
    return (
      <>
        {heading}
        <DataSkeleton kind="metrics" label="Loading your positions" />
        <DataSkeleton label="Loading balances and requests" />
      </>
    )
  const last = ov.data?.last
  const dec = p.decimals
  const rows = p.tranches
    .map((t) => {
      const pos = acct.data!.positions.find((x) => x.index === t.index)!
      const price = last?.sharePrices[t.index]
      return {
        t,
        pos,
        value: price != null ? (pos.shares * price) / 10n ** 18n : null
      }
    })
    .filter(
      ({ t, pos }) =>
        PRODUCT.entryChains.includes(t.chainId) || hasPosition(pos)
    )
  const total = rows.every((r) => r.value !== null)
    ? rows.reduce((a, r) => a + (r.value ?? 0n), 0n)
    : null
  return (
    <>
      {heading}
      <div className="grid grid-3" style={{ marginBottom: 16 }}>
        <div className="card">
          <h3>Position value</h3>
          <div className="kpi">
            {fmt(total, dec)} <span className="sub">USDC</span>
          </div>
          <div className="sub">
            {last
              ? `At settlement #${last.id} prices`
              : 'Awaiting settlement prices'}
          </div>
        </div>
        <div className="card">
          <h3>Wallet USDC</h3>
          {Object.entries(acct.data.balances).map(([c, b]) => (
            <div
              key={c}
              className="row"
              style={{ justifyContent: 'space-between' }}
            >
              <span className="sub">{chainLabel(Number(c))}</span>
              <span>{fmt(b, dec)}</span>
            </div>
          ))}
        </div>
        <div className="card">
          <h3>Access</h3>
          {p.tranches
            .filter((t) => PRODUCT.entryChains.includes(t.chainId))
            .map((t) => (
              <div className="portfolio-access-row" key={t.index}>
                <span>{t.type}</span>
                <Link className="text-link" href={ticketHref(t.type)}>
                  {acct.data!.eligibility[t.index]
                    ? 'Deposit access granted'
                    : 'Check access →'}
                </Link>
              </div>
            ))}
          <p className="sub">
            Access is checked per tranche. Claims are listed separately and
            remain subject to the vault’s transfer rules.
          </p>
        </div>
      </div>
      <section
        className="card portfolio-next"
        aria-labelledby="portfolio-next-title"
      >
        <h3 id="portfolio-next-title">Your next action</h3>
        <p className="sub">
          Claims require a separate wallet transaction after settlement. Pending
          requests continue independently.
        </p>
        <div className="grid grid-2">
          {rows
            .filter(({ t }) => PRODUCT.entryChains.includes(t.chainId))
            .map(({ t, pos }) => (
              <div className="position-action-card" key={t.index}>
                <span className={`pill ${t.type.toLowerCase()}`}>{t.type}</span>
                <div className="position-actions">
                  {positionActions(pos, acct.data!.eligibility[t.index]).map(
                    (action) => (
                      <Link
                        key={action.label}
                        className={`btn ${action.kind === 'claim' ? 'primary' : 'secondary'}`}
                        href={
                          action.kind === 'track'
                            ? '/activity'
                            : ticketHref(t.type, action.mode)
                        }
                      >
                        {action.label}
                      </Link>
                    )
                  )}
                </div>
              </div>
            ))}
        </div>
      </section>
      <div className="card" style={{ marginBottom: 16 }}>
        <h3>Positions</h3>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Tranche</th>
                <th>Network</th>
                <th className="num">Shares</th>
                <th className="num">Value (USDC)</th>
                <th>Pending</th>
                <th>Claimable</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ t, pos, value }) => (
                <tr key={t.index}>
                  <td>
                    <span className={`pill ${t.type.toLowerCase()}`}>
                      {t.type}
                    </span>
                  </td>
                  <td>
                    {chainLabel(t.chainId)}
                    {!PRODUCT.entryChains.includes(t.chainId) && (
                      <small className="sub"> · Strategy vault</small>
                    )}
                  </td>
                  <td className="num">{fmt(pos.shares, dec, 4)}</td>
                  <td className="num">{fmt(value, dec)}</td>
                  <td className="sub">
                    {pos.deposit.pending > 0n && (
                      <>
                        Deposit {fmt(pos.deposit.pending, dec)} USDC
                        <br />
                      </>
                    )}
                    {pos.redeem.pending > 0n && (
                      <>Redeem {fmt(pos.redeem.pending, dec)} shares</>
                    )}
                  </td>
                  <td className="sub">
                    {pos.deposit.claimable > 0n && (
                      <>
                        Deposit of {fmt(pos.deposit.claimable, dec)} USDC
                        <br />
                      </>
                    )}
                    {pos.redeem.claimable > 0n && (
                      <>Redemption of {fmt(pos.redeem.claimable, dec)} shares</>
                    )}
                    {pos.deposit.claimable === 0n &&
                      pos.redeem.claimable === 0n &&
                      '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="sub" style={{ marginBottom: 0 }}>
          Claimable amounts describe the original request, not the final payout.
          Settlement determines the shares or USDC you receive. Use the actions
          above to open the matching tranche; nothing is submitted until you
          confirm in your wallet.
        </p>
      </div>
      <div className="card">
        <h3>Received</h3>
        {recv.isError ? (
          <QueryNotice
            title="Unable to load received claims"
            retry={() => {
              void recv.refetch()
            }}
          />
        ) : !recv.data ? (
          <DataSkeleton label="Loading received claims" rows={2} />
        ) : !recv.data.length ? (
          <div className="sub">Your completed claims will appear here.</div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Kind</th>
                  <th>Network</th>
                  <th className="num">Amount</th>
                  <th>Tx</th>
                </tr>
              </thead>
              <tbody>
                {recv.data.map((r) => {
                  const url = txUrl(r.chainId, r.txHash)
                  return (
                    <tr key={r.txHash}>
                      <td>{r.at?.toLocaleString() ?? '—'}</td>
                      <td>{r.kind === 'deposit' ? 'Shares' : 'USDC'}</td>
                      <td>{chainLabel(r.chainId)}</td>
                      <td className="num">{fmt(r.amount, dec, 4)}</td>
                      <td>
                        {url ? (
                          <a
                            className="mono"
                            href={url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {short(r.txHash)}
                          </a>
                        ) : (
                          <span className="mono">{short(r.txHash)}</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  )
}
