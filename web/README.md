# Achilles frontend

Achilles presents a cross-chain strategy with Senior and Junior tranches. The approved blue/silver helmet-and-A artwork lives in `public/brand/achilles.png`. The interface uses navy surfaces, blue Senior accents and violet Junior accents.

## Run

From the repository root:

```sh
pnpm install
pnpm --filter achilles-web dev
pnpm --filter achilles-web typecheck
pnpm --filter achilles-web test
pnpm --filter achilles-web build
```

Copy `.env.example` to `.env.local` inside `web/` and configure the public Settlement Hub RPC and WalletConnect project ID. These values are intentionally left blank in the template. Restart the development server after changing public environment variables; deployment changes require a rebuild.

Without a Hub RPC, the strategy and configured target allocations remain visible, while live values display a dash and transaction submission is unavailable. Returns, chart history and balances are never generated as placeholders. WalletConnect QR connections require a project ID; browser-extension support depends on an installed compatible wallet.

## Screens and flow

- **Landing (`/`):** protocol introduction, source-to-tranche visual, underlying assets, risk layers, access steps, settlement explanation and FAQ. Launch app opens the product catalog.
- **Products (`/products`):** searchable product catalog with list/card views, recorded NAV, Senior target APR, Junior return and deposit network.
- **Product detail (`/products/stocks-stable`):** synchronized tranche selection, metrics and performance, stock allocation/holdings/prices, settlement flow and history, plus the investment ticket. A `tranche=junior` link carries a landing-page choice into the ticket.
- **Portfolio:** wallet balances, settlement-valued shares, pending requests, claimable original request amounts, completed receipts.
- **Activity:** request, bridge and settlement progress from the on-chain registry.

User entry is on Sepolia. The configured strategy targets a 50/50 capital split between a Robinhood testnet stock basket and a Sepolia USDC/USDT test pool. Targets are distinct from observed holdings. A request must settle before it can be claimed; Junior absorbs losses before Senior, and neither tranche guarantees capital or returns.

A claimable deposit amount represents the original USDC request, while a claimable redemption amount represents the original shares. These are not the final claim payout amounts.

## Data and server endpoints

`src/lib/reads.ts` reads Hub precompiles and spoke contracts directly. React Query manages polling and request deduplication. Independent overview reads can fail separately. Missing prices stay distinct from zero prices.

`src/lib/writes.ts` simulates operations, checks approval receipts and allowance propagation, and confirms transaction receipts. The investment panel reacquires the wallet client after a network switch and locks tranche selection while submitting.

- `GET /api/worldid` signs a short-lived World ID context on the server. Configure public app/RP identifiers and environment plus server-only `RP_SIGNING_KEY`.
- `POST /api/whitelist` requires an explicit `senior` or `junior` tranche. Senior requires a verified World ID 4.0 Proof of Human for the expected action, environment and wallet signal. The HumanRegistry records one human-to-wallet binding; retries resume the same binding if the subsequent Hub grant failed. Junior uses server-only `INVITE_CODE`, without a default value, and cannot grant Senior.
- `POST /api/gas` requires permission for either configured Sepolia tranche and tops up to 0.02 test ETH. `POST /api/faucet` tops up the configured test token to 1,000 USDC. Server writes need `OPS_PRIVATE_KEY`; access and gas also need the Hub configuration.
- `GET /api/multibaas?limit=25` reads indexed Sepolia events using server-only `MULTIBAAS_URL` and `MULTIBAAS_ACHILLES_READER`. The admin key is not used by the application. Missing integration configuration returns 503; unavailable upstream data returns a JSON error without hiding direct chain data.

The operations key needs the appropriate Hub grant, HumanRegistry verifier and token mint permissions, as well as testnet gas. Never expose it through a `NEXT_PUBLIC_` variable. Broadcast access grants remain pending until the eligibility read confirms them; mined funding transactions are checked for success. Proof payloads and server credentials are not logged.

An in-process queue and bounded contention retries reduce concurrent operations-key failures. They are not a distributed lock. These are testnet helpers: balance thresholds are not durable per-person rate limits, and simultaneous requests on separate serverless instances can race. Broader release needs shared idempotency/rate limits and wallet ownership authentication.

`NEXT_PUBLIC_SETTLE_SECS` optionally reflects the keeper cadence. Set it to the actual operator configuration; leaving it empty uses the registered schedule. It is an estimate, not a promised completion time.

## Verification limits

Unit tests cover return calculations, complete-loss prices, exact integer formatting and strict token amount parsing, and rejection of mismatched World actions, environments, wallet signals and credentials. Type checking and production builds cover all routes. Completing a real deposit → settlement → claim flow additionally requires working RPCs, an activated deployment, configured operator permissions and a funded test wallet.

## IR-inspired experience

This design variant uses a cinematic midnight coastline, luminous source connections and layered glass tranche controls. The background is an AI-generated environment; the approved Achilles logo is preserved separately.

The flow is **understand the sources → choose a risk layer → request an investment → follow settlement → claim**. Hero controls, risk-profile controls and the investment ticket share the selected tranche. The yield/loss explainer shows allocation priority without hypothetical financial returns. Mobile offers a direct jump to the investment section and persistent bottom navigation.

Stocks and stablecoin liquidity are the configured testnet sources. Lending, bonds, real-world assets and custom strategies are explicitly marked as product vision, not available integrations. The new presentation reuses the existing wallet, transaction and API implementation.

The Webpack development path is available via `pnpm --filter achilles-web dev --webpack`. Optional payment-module aliases use exact matches so root module aliases do not consume subpaths.

## Market workspace

The product detail page places stock prices and holdings beside a guided investment ticket. Senior/Junior selection drives the Sepolia tranche metrics, performance chart and transaction ticket together. Other networks are shown as sources, not additional deposit entry points. The public landing page remains a separate introduction; the brand link always returns home, and the product breadcrumb returns to the catalog.

- **Assets & prices:** searchable stock basket, current pool quotes, adapter token balances, current marked values, actual versus target basket weights, token/pool details and snapshot block. Source data loads independently of the Hub.
- **Allocation and holdings:** source-principal donut and stock-value pie with separate Actual/Target controls. Zero holdings remain empty; incomplete data is never normalized into a full portfolio. Company logos load from TradingView with a text fallback.
- **Stock price history:** up to 60 finalized rounds of recorded adapter valuations, indexed to a common positive baseline. Hover, touch and keyboard controls reveal settlement prices; stocks can be toggled independently. Missing records leave gaps, and at least two recorded prices are required for a series. TradingView supplies logos only, not price data.
- **Price basis:** pool quotes are testnet USDC prices. Recorded valuation prices come from the last finalized settlement. Their difference is labeled “Vs. settlement”; it is not a daily return. Stock values exclude idle adapter cash. Missing values stay distinct from zero balances.
- **Performance:** selected-layer share prices, optional layer comparison, date ranges and an accessible settlement scrubber. At least two recorded points are required to draw a series.
- **Settlements:** recent recorded rounds, cycle details from the registry and CSV export of loaded history. A missing cycle trace does not change a round's recorded pricing status.
- **Investment:** wallet/network, tranche-specific access, gas and token prerequisites; a test-USDC faucet; balance percentage shortcuts; estimated payout and last share price; review before submitting; existing request and claim actions. Senior uses World ID and Junior uses an invite code. The configured token address remains visible.

The gas helper accepts investor permission on either configured Sepolia tranche. The server still requires its operating key and funded account. No wallet transactions are generated by browsing market data or reviewing a request.

## Motion and loading

The landing introduces sources, the structuring layer and tranches in sequence, with a slow light current along available source connections. The central logo remains stationary; a short, masked metallic reflection repeats with a quiet pause and responds to a mouse pointer. Sections reveal once as they enter view. Ambient effects pause when their visual is offscreen or the tab is hidden.

React/Next view transitions connect pages and crossfade the Allocation, Holdings and Prices panels without replacing investment form state. Navigation uses the router's pending state; route skeletons and initial data placeholders retain the surrounding layout. Background refetches keep existing values visible. Unsupported browsers retain normal navigation with a short entry fade.

FAQ answers expand and collapse as one clipped grid track, including their spacing; rapid toggles reverse the same transition. Controls use brief hover/press feedback; expandable content, transaction status and chart panels have restrained entrance transitions. The visible Pause motion control and the system's reduced-motion setting disable animation, including native page transitions and smooth scrolling. No animation delays transaction submission or fabricates market values.
