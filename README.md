# Achilles

Achilles helps users understand and choose risk across a cross-chain portfolio,
with Senior/Junior tranches, observable pricing, and asynchronous settlement and claims.

- A hub chain holds no capital. It only records requests, prices the product each
  settlement cycle, and decides how funds move.
- User-facing vaults (ERC-7540 request/claim, Senior/Junior tranches) live on one
  spoke network; other spokes run capital without an entry point of their own.
- Capital is allocated across yield sources that can live on any spoke: a
  tokenized-stock basket traded against Uniswap V3 pools, and a stablecoin pair
  supplied to a Uniswap V2 pair on Sepolia.
- Shares are ERC-1404 — only allow-listed wallets can hold them, with the
  allow-list itself replicated from the hub to every spoke.

## Layout

```
contracts/   Solidity (Hardhat)
  contracts/hub/         settlement ledger (a diamond: intake + settlement facets)
                          and the router that relays messages hub <-> spokes
  contracts/spoke/       vault coordinator, capital allocator, request vault,
                          share token, allow-list hook, bridge fee sponsor
  contracts/sources/     yield sources a spoke's allocator can route into
  contracts/bridge/      cross-chain messaging client, wire format, retry bookkeeping
  contracts/libraries/   shared read/apply logic
  contracts/interfaces/  boundary types
  contracts/mocks/       local stand-ins for the pallet precompiles and external pools
  deployments/           addresses of the live deployment the web app reads

frontend/         dapp (Next.js + wagmi/viem). Reads chain state directly and uses server routes for World ID,
             testnet funding and MultiBaas indexed activity.
```

## Run

```
pnpm install
pnpm compile                      # contracts
pnpm --filter achilles-web dev       # dapp on :3000
```

The dapp needs `frontend/.env.local` (copy `frontend/.env.example`): public RPC URLs, a
WalletConnect project id, and — for server routes that grant access and supply
testnet funds — an operator key.

The landing page is `/`, the product directory is `/products`, the current
strategy is `/products/stocks-stable`, and connected-wallet views are
`/portfolio` and `/activity`. Never commit local environment files or keys.
Server credentials belong only in server environment variables, never in
`NEXT_PUBLIC_*` variables. Public RPC and wallet configuration are visible to
the browser even when their source environment file is Git-ignored.

## Test and review

```sh
pnpm --filter achilles-web test
pnpm --filter achilles-web typecheck
pnpm --filter achilles-web build
```

The frontend tests cover financial display boundaries, chart gaps, World proof
validation, loss allocation, and concurrent claim/pending states. Passing these
tests does not prove a live wallet has completed the entire deposit/redemption cycle.

For a live walkthrough: inspect holdings and pool/settlement price provenance,
choose a tranche, obtain access, fund a Sepolia wallet, review and submit a
deposit request, track settlement, then claim shares. A redemption requires its
own request, settlement, and USDC claim. Record actual transaction receipts for
both journeys; do not portray a pending request as completed funds delivery.

## Integrations

| Integration | Implementation and observable behavior |
| --- | --- |
| Uniswap V3 | [StockBasketSource](contracts/contracts/sources/StockBasketSource.sol#L272): basket rebalancing uses `exactInputSingle`; current pool quotes and recorded valuations are shown separately in [Allocation](frontend/src/components/Allocation.tsx). |
| Uniswap V2 | [StablePoolSource](contracts/contracts/sources/StablePoolSource.sol#L92): swaps, adds/removes liquidity, and values LP shares. The UI links the Sepolia pool and strategy adapter. |
| World IDKit | [WorldVerification](frontend/src/components/WorldVerification.tsx), [server verification](frontend/src/app/api/whitelist/route.ts), and [HumanRegistry](contracts/contracts/spoke/HumanRegistry.sol): server-verified Proof of Human is bound to the wallet and action before Senior permission is granted. Junior uses a separate invite policy. |
| Curvegrid MultiBaas | [Server proxy](frontend/src/app/api/multibaas/route.ts) uses a reader credential to retrieve indexed events. [PoolActivity](frontend/src/components/PoolActivity.tsx) interprets known events; balances and claim availability come from direct chain reads. |

See [integration feedback](FEEDBACK.md) for concrete findings and remaining live
verification. [Deployment configuration](contracts/deployments/eg_deploy.json)
identifies the actual networks, assets, and contract addresses. The Sepolia V2
factory/router match the [official deployment list](https://developers.uniswap.org/docs/protocols/v2/deployments).
Robinhood testnet V3 provenance must be evaluated separately; this is not a claim
that it is an official mainnet deployment.

## Real-world assets, and what becomes programmable

The portfolio holds tokenized equities — an eight-name technology basket traded
against Uniswap V3 pools — alongside a stablecoin liquidity position. Tokenizing
the basket is the starting point, not the product. What the tokenized form makes
possible is the rest of it:

- **A fixed-rate claim on a real portfolio.** Senior takes a fixed APR ahead of
  Junior each settlement, the way a treasury tranche sits ahead of equity. That
  waterfall is a contract, not a fund administrator: the hub prices both tranches
  from the sources' reported valuations and settles them in the same round.
- **Ownership that carries its own rules.** Shares are ERC-1404; a transfer asks
  the allow-list hook first, so eligibility travels with the asset instead of
  living in an off-chain register. The allow-list is granted on the hub and
  replicated to every spoke, so one permission decision reaches every chain the
  asset is held on.
- **Access proportionate to scarcity.** Senior capacity is the scarce benefit, so
  it is gated on a verified human rather than a wallet. Junior, which absorbs
  losses first and has no cap, stays open. The scarce claim and the open claim on
  the same assets are governed differently, on chain.
- **Settlement as a workflow, not a batch job.** Requests are ERC-7540: submitted,
  priced at a settlement, then claimed. Each stage of every request and every
  settlement — including which chain answered and which bridge attempt failed —
  is written to the hub's registry and readable by anyone.

The assets are testnet representations; the mechanics around them are the point.

## Current boundaries

- This is a testnet product. Basket tokens and pool quotes do not establish
  ownership of legal company shares or live exchange pricing.
- Junior absorbs losses first; Senior can also lose capital. The interactive
  $100 loss scenario is an illustration, not the live tranche capitalization.
- World registration restricts duplicate human registrations, not investment
  amounts. It is not KYC or a financial suitability check.
- The settlement hub records and coordinates; it does not custody portfolio
  capital. No hub explorer is exposed. Confidentiality is not an end-to-end
  privacy guarantee; public-chain movements remain visible.
- Keeper availability, cross-chain delivery, funding, permissions, and actual
  human verification must be tested against the submitted deployment.

## Team and development

Team Achilles:

| | Role | Telegram |
| --- | --- | --- |
| 김상욱 | Contracts, settlement, cross-chain | [@fjdi789](https://t.me/fjdi789) |
| 샴쇼드 | Product, World ID integration | [@shamshod_zk](https://t.me/shamshod_zk) |
| 김기황 | Frontend, design, frontend API integration | [@honggwngji](https://t.me/honggwngji) |

AI-assisted development includes frontend implementation, code review, tests,
and documentation. This statement describes the frontend assistance reflected
here; the team should describe its complete contribution and development history
in the event submission.

## Frontend AI assistance

See [Frontend AI assistance and human direction](frontend/AI_USAGE.md) for the
frontend contributor's workflow and implementation references. This document
covers the frontend and its application API routes, not the entire project.
