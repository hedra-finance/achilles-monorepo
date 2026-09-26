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

Team Achilles: 샴쇼드, 김상욱 ([woogie96](https://github.com/woogie96)),
and 김기황 (frontend, design, and frontend API integration).
Additional public profiles and final submission roles are maintained by the team.

AI-assisted development includes frontend implementation, code review, tests,
and documentation. This statement describes the frontend assistance reflected
here; the team should describe its complete contribution and development history
in the event submission.

## AI assistance

See [AI assistance and human direction](AI_USAGE.md) for the scope of AI-assisted
work, human review and guidance, and links to the implementation areas.
