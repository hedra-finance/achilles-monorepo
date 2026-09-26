export type TicketMode = 'invest' | 'redeem'
type Position = {
  shares: bigint
  deposit: { pending: bigint; claimable: bigint }
  redeem: { pending: bigint; claimable: bigint }
}

export function hasPosition(position: Position) {
  return (
    position.shares > 0n ||
    position.deposit.pending > 0n ||
    position.deposit.claimable > 0n ||
    position.redeem.pending > 0n ||
    position.redeem.claimable > 0n
  )
}

export function positionActions(
  position: Position,
  eligible: boolean | undefined
) {
  const actions: {
    label: string
    mode?: TicketMode
    kind: 'claim' | 'track' | 'manage'
  }[] = []
  if (position.deposit.claimable > 0n)
    actions.push({ label: 'Claim shares', mode: 'invest', kind: 'claim' })
  if (position.redeem.claimable > 0n)
    actions.push({ label: 'Claim USDC', mode: 'redeem', kind: 'claim' })
  if (position.deposit.pending > 0n || position.redeem.pending > 0n)
    actions.push({ label: 'Track pending request', kind: 'track' })
  if (position.shares > 0n)
    actions.push({
      label: 'Request redemption',
      mode: 'redeem',
      kind: 'manage'
    })
  if (!actions.length)
    actions.push({
      label: eligible ? 'Start a position' : 'Check access',
      mode: 'invest',
      kind: 'manage'
    })
  return actions
}

export function ticketHref(
  layer: 'Senior' | 'Junior',
  mode: TicketMode = 'invest'
) {
  return `/products/stocks-stable?tranche=${layer.toLowerCase()}&mode=${mode}#invest`
}
