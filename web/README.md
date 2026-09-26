# Achilles frontend

Achilles presents a cross-chain strategy with Senior and Junior tranches. The approved blue/silver helmet-and-A artwork lives in `public/brand/achilles.png`. The interface uses navy surfaces, blue Senior accents and violet Junior accents.

## Run

From the repository root:

```sh
pnpm install
pnpm --filter hedra-web dev
pnpm --filter hedra-web typecheck
pnpm --filter hedra-web test
pnpm --filter hedra-web build
```

Copy `.env.example` to `.env.local` inside `web/` and configure the public Settlement Hub RPC and WalletConnect project ID. These values are intentionally left blank in the template. Restart the development server after changing public environment variables; deployment changes require a rebuild.

Without a Hub RPC, the strategy and configured target allocations remain visible, while live values display a dash and transaction submission is unavailable. Returns, chart history and balances are never generated as placeholders. WalletConnect QR connections require a project ID; browser-extension support depends on an installed compatible wallet.

## Screens and flow

- **Earn:** strategy overview, settlement share-price history, synchronized tranche selection, deposit/redemption requests and claims, yield-source composition.
- **Portfolio:** wallet balances, settlement-valued shares, pending requests, claimable original request amounts, completed receipts.
- **Activity:** request, bridge and settlement progress from the on-chain registry.

User entry is on Sepolia. The configured strategy targets a 50/50 capital split between a Robinhood testnet stock basket and a Sepolia USDC/USDT test pool. Targets are distinct from observed holdings. A request must settle before it can be claimed; Junior absorbs losses before Senior, and neither tranche guarantees capital or returns.

A claimable deposit amount represents the original USDC request, while a claimable redemption amount represents the original shares. These are not the final claim payout amounts.

## Data and server endpoints

`src/lib/reads.ts` reads Hub precompiles and spoke contracts directly. React Query manages polling and request deduplication. Independent overview reads can fail separately. Missing prices stay distinct from zero prices.

`src/lib/writes.ts` simulates operations, checks approval receipts and allowance propagation, and confirms transaction receipts. The investment panel reacquires the wallet client after a network switch and locks tranche selection while submitting.

`POST /api/whitelist` requires the invite code and grants the configured vault permissions. `POST /api/gas` requires Hub investor permission and tops up a low Sepolia ETH balance. Both require server-only `OPS_PRIVATE_KEY` and Hub configuration. The whitelist endpoint also requires a server-only `INVITE_CODE`; no public default is accepted. Invalid inputs return JSON errors; missing setup returns 503; unsuccessful network operations return 502. Never expose the operations key through a `NEXT_PUBLIC_` variable.

These are hackathon testnet helpers, not hardened public faucet/authentication infrastructure. Before a broader release, add durable per-wallet limits, concurrency/idempotency protection and wallet ownership authentication. An allow-list check alone does not prevent repeated faucet withdrawals.

## Verification limits

Unit tests cover return calculations, complete-loss prices, exact integer formatting and strict token amount parsing. Type checking and production builds cover all routes. Completing a real deposit → settlement → claim flow additionally requires working RPCs, an activated deployment, configured operator permissions and a funded test wallet.

## IR-inspired experience

This design variant uses a cinematic midnight coastline, luminous source connections and layered glass tranche controls. The background is an AI-generated environment; the approved Achilles logo is preserved separately.

The flow is **understand the sources → choose a risk layer → request an investment → follow settlement → claim**. Hero controls, risk-profile controls and the investment ticket share the selected tranche. The yield/loss explainer shows allocation priority without hypothetical financial returns. Mobile offers a direct jump to the investment section and persistent bottom navigation.

Stocks and stablecoin liquidity are the configured testnet sources. Lending, bonds, real-world assets and custom strategies are explicitly marked as product vision, not available integrations. The new presentation reuses the existing wallet, transaction and API implementation.

The Webpack development path is available via `pnpm --filter hedra-web dev --webpack`. Optional payment-module aliases use exact matches so root module aliases do not consume subpaths.
