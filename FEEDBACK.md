# Achilles integration feedback

This records findings from the current integration. It does not claim unrecorded
human verification or transaction success. The live evidence checklist below
must be completed for the submitted deployment.

## Uniswap

### What we built

- The stock basket adapter uses V3 `exactInputSingle` to rebalance testnet assets.
  See [StockBasketSource](contracts/contracts/sources/StockBasketSource.sol#L272),
  particularly `rebalance`, `_sellForShortfall`, and `_swap`.
- The stablecoin adapter uses V2 swaps and liquidity provision/removal. See
  [StablePoolSource](contracts/contracts/sources/StablePoolSource.sol#L92),
  particularly `allocate`, `release`, `_swap`, and `_addLiquidity`.
- The frontend reads token balances, pool quotes/reserves, LP ownership, and
  finalized settlement records. See [reads](frontend/src/lib/reads.ts),
  [Allocation](frontend/src/components/Allocation.tsx), and
  [StockPricesChart](frontend/src/components/StockPricesChart.tsx).

### Friction and improvements

1. Pool spot quotes and finalized portfolio valuations have different meanings.
   We display their provenance and comparison baseline separately, retain missing
   values, and never label a settlement delta as a 24-hour return.
2. Token ordering and decimals affect `sqrtPriceX96` conversion and holdings
   valuation. Frontend tests cover both orientations, token decimals, zero
   prices, and missing data.
3. A short testnet history can turn entry costs into a misleading annualized
   figure. The UI reports a period return until sufficient history exists.
4. Deployment provenance must be established per network/version. Sepolia V2
   addresses match the official factory/router list; a testnet V3 deployment
   should not inherit a mainnet provenance claim.

The highest-impact documentation improvement for this integration would be one
worked example connecting pool token ordering/decimals, executable quotes, and
portfolio valuation, with explicit spot-price and testnet assumptions.

Before submission, attach the actual swap and LP add/remove receipts and complete
the separate [hackathon feedback form](https://developers.uniswap.org/hackathon-feedback)
with a link to this file. Creating this file does not submit that form.

## World IDKit

**Trust event:** grant Senior registration to one verified human at one wallet.
Proof of Human is the assurance required by that policy; legal identity documents
would not serve the implemented uniqueness check. This registration rule does
not enforce a per-human capital allocation limit.

**Integration:** IDKit uses a server-signed RP context. The backend validates the
action, environment, wallet signal, credential, verified response, and nullifier
before recording the human/wallet binding and granting permission. A partial
success can be retried without silently skipping the permission step.

**Alternative:** cancellation leaves access locked; unsupported or rejected
credentials can be retried. Junior is separately invite-gated and carries a
different first-loss risk. Choosing Junior is not a bypass into Senior.

**Observed friction:** a successful proof, a confirmed HumanRegistry transaction,
and propagated deposit permission are distinct states. The UI must not announce
deposit readiness at the first of these boundaries.

**Most useful improvement:** a documented resumable example for verification →
on-chain registration → delayed cross-chain permission, including cancellation
and a retry after the registration transaction succeeds.

**Time to first live success:** not measured in this review. Record the actual
time, environment, credential, and successful protected action during the team's
live test. Unit tests and mocked API paths are not substitutes for this evidence.

## Curvegrid MultiBaas

MultiBaas supplies indexed pool activity through a server-only reader credential.
We normalize its event envelope and address labels, validate responses, and
present unsupported/unavailable data without substituting invented events.
Direct chain reads remain authoritative for balances and claims.

**Observed friction:** the event envelope and contract address label need to be
resolved explicitly; treating an indexed event as a current balance would give
misleading claim instructions.

**Most useful improvement:** one end-to-end typed example from the event API
response to a portfolio activity row, documenting address labels, indexing lag,
and how to reconcile historical events with current contract state.

The dashboard connects asset composition, price provenance, per-tranche access,
pending requests, and current claim actions. Confirm actual event delivery and
freshness against the team's configured instance before recording the demo.

## Live evidence still to capture

- Successful human verification and confirmed Senior access; a cancelled or
  rejected attempt that cannot grant access; duplicate-human rejection.
- Deposit → settlement → share claim, then redemption → settlement → USDC claim,
  with real receipts, network, request identifier, and timestamps.
- V3 execution and V2 liquidity receipts; final pool and portfolio state.
- MultiBaas indexed event delivery and its corresponding transaction.
- Exact deployed commit, public repository visibility/license, and the final
  measured integration debrief. Do not mark these complete based on a local build.
