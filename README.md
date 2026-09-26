# Achilles

Cross-chain tranche vaults settled from a single hub, with capital split across
independent yield sources on different networks.

- A hub chain holds no capital. It only records requests, prices the product each
  settlement cycle, and decides how funds move.
- User-facing vaults (ERC-7540 request/claim, Senior/Junior tranches) live on one
  spoke network; other spokes run capital without an entry point of their own.
- Capital is allocated across yield sources that can live on any spoke: a
  tokenized-stock basket traded against Uniswap V3 pools, and a stablecoin pair
  supplied as Uniswap V2-style LP.
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

web/         dapp (Next.js + wagmi/viem). Talks to the chains directly — no
             indexer, no backend service, no SDK.
```

## Run

```
pnpm install
pnpm compile                      # contracts
pnpm --filter achilles-web dev       # dapp on :3000
```

The dapp needs `web/.env.local` (copy `web/.env.example`): public RPC URLs, a
WalletConnect project id, and — only for the two server routes that hand out
allow-list entries and testnet gas — an operator key.
