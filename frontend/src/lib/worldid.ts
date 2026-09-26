import { PRODUCT } from './product'
/** World ID identifiers. Public values only — the RP signing key stays in the server env. */
export const WORLD_ID = {
  appId: (process.env.NEXT_PUBLIC_WORLD_APP_ID ?? '') as `app_${string}`,
  rpId: process.env.NEXT_PUBLIC_WORLD_RP_ID ?? '',
  /** What the person is proving uniqueness for. Scopes the nullifier, so it must not change. */
  action: `senior-allocation-${PRODUCT.idHex}`,
  verifyUrl: (rpId: string) =>
    `https://developer.world.org/api/v4/verify/${rpId}`,
  /** Production credentials; staging apps issue proofs the production verifier rejects. */
  environment: (process.env.NEXT_PUBLIC_WORLD_ENV ?? 'production') as
    'production' | 'staging'
}

export const worldIdConfigured = () =>
  WORLD_ID.appId.startsWith('app_') &&
  WORLD_ID.rpId.startsWith('rp_') &&
  (WORLD_ID.environment === 'production' || WORLD_ID.environment === 'staging')
