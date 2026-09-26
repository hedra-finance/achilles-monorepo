/** Wallet signatures authorize only completing access for this wallet and product. */
export function accessResumeMessage(
  origin: string,
  address: string,
  product: string,
  issuedAt: number
) {
  return `Achilles: complete Senior access\nOrigin: ${origin}\nWallet: ${address.toLowerCase()}\nProduct: ${product}\nIssued at: ${issuedAt}\nThis does not authorize a transfer or deposit.`
}

export function validResumeTime(
  value: unknown,
  now = Date.now()
): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value <= now + 30_000 &&
    value >= now - 300_000
  )
}

export type AccessStatus = {
  registered: boolean | null
  granted: boolean
  ready: boolean
}

export function accessPhase(
  status: AccessStatus | undefined,
  pending: boolean
) {
  if (status?.ready) return 'ready'
  if (status?.granted) return 'syncing'
  if (pending) return 'checking'
  if (status?.registered) return 'resume'
  return 'verify'
}
