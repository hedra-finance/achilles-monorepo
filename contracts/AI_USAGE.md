# AI assistance and human direction in the Achilles contracts

This document covers AI assistance in the contracts, the settlement pipeline, the
cross-chain messaging layer, and the operational scripts that drive them. It
describes my direction as the contracts contributor, what I delegated, and where
that work appears. It is not a project-wide account of AI usage, and it does not
speak for my teammates' contributions.

I made the design decisions, chose what to build and what to refuse, and decided
what counted as evidence that something worked. The agent helped with analysis,
implementation, regression tests, on-chain diagnosis, and operational scripting
under that direction. Several of its proposals were wrong and I rejected them;
those are recorded below, because a document that only lists successes would
misrepresent how the work actually went.

## How I directed the work

### Architecture decisions

The shape of the system was mine. I decided that `VaultCoordinator` and
`CapitalAllocator` should be one deployment per chain keyed by `productId`
rather than one per product, that the ledger should likewise be a single global
diamond, and that the bridge endpoint should be split out of the coordinator
into its own [SpokeRouter](contracts/spoke/SpokeRouter.sol). That last split was
not cosmetic: the bridge wiring was about a quarter of the coordinator's
bytecode, and EIP-170 had left it six bytes of room.

I also decided to discard the previous product and deploy a new one rather than
migrate, because the demo did not need continuity and a migration would have
cost more than it returned.

### Refusing the easy version

When a deposit's entry into the liquidity pool cost existing holders money, the
agent proposed charging each depositor an estimated levy up front. I rejected it
— an estimate collected in advance is still a charge, and it would have been
wrong in both directions. I said the cost should not exist. What came back was a
par-exchange desk that supplies the missing leg one for one, trading only the
imbalance, and standing aside entirely when the pool is outside an entry band.
That is in [StablePoolSource](contracts/sources/StablePoolSource.sol).

Later, when a settlement round was stuck, the agent proposed clearing the flag
and moving on. I refused: that would have left the records broken and the cause
unfound. The cause turned out to be a message below the carrier minimum being
rejected by the bridge, and the fix is a promotion rule in
[BridgeClient](contracts/bridge/BridgeClient.sol) rather than a swept-away
symptom.

### Evidence, not inference

I required that behaviour be demonstrated rather than argued. In practice that
meant a few standing rules:

- Diagnose against the live chain, not by reading the source and reasoning. When
  the agent spent too long tracing code paths, I told it to query the node.
- Prove a fix with a test that fails on the old code and passes on the new one.
  Several regression tests in this project exist because I asked what would have
  caught the bug, not what confirms the patch.
- Where a mock stands in for a node precompile, the mock must reject what the
  real one rejects. One bug survived its own test because the mock accepted
  duplicate entries that the live pallet refuses; I had the mock tightened before
  accepting the fix.
- Simulate before sending. On-chain actions are called read-only first, and
  deployment scripts carry a dry run.

### Approval over on-chain actions

No transaction, deployment or push happened without my go-ahead. That includes
contract upgrades, funding movements, permission grants and anything touching
the public repository. Where an action was irreversible — a facet replacement, a
history rewrite — I asked for the consequences first and decided from there.

### Remediation order

During an outage I told the agent to stop looking for the cause and fix
everything suspicious first, then find it. It had been reading source to narrow
a revert while settlement stayed down. Restoring service comes before
understanding it, and the understanding is easier once the obvious causes are
gone.

## Where AI assistance was applied

Reviewed or modified with AI assistance under my direction:

- [SettlementFacet](contracts/hub/ledger/SettlementFacet.sol) and
  [LedgerStorage](contracts/hub/ledger/LedgerStorage.sol) — the collection and
  settlement pipeline, including stall recovery and the per-round valuation
  buffer.
- [VaultCoordinator](contracts/spoke/VaultCoordinator.sol) and
  [SpokeRouter](contracts/spoke/SpokeRouter.sol) — the multi-product refactor and
  the bridge endpoint split.
- [HumanRegistry](contracts/spoke/HumanRegistry.sol) — the uniqueness rule for the
  scarce tranche, and the action-scoped binding that lets the flow be rehearsed.
- [AllowlistHook](contracts/spoke/AllowlistHook.sol) — the transfer gate the
  restricted shares consult.
- [StablePoolSource](contracts/sources/StablePoolSource.sol) and
  [StockBasketSource](contracts/sources/StockBasketSource.sol) — the two yield
  sources and their entry and valuation rules.
- [BridgeClient](contracts/bridge/BridgeClient.sol) — carrier minimums, fee
  sponsorship and the wire format.

The regression tests and the deployment and operational scripts were written the
same way, under the same rules. They are not published in this repository.

## Where I corrected the work

These are worth recording because they shaped the result:

- **An estimated entry levy**, rejected in favour of removing the cost.
- **Clearing a stuck settlement flag**, rejected in favour of finding the cause.
  I later approved the same call once the cause was fixed and the call had been
  shown to do nothing else.
- **Vague sponsor feedback.** A first draft blamed two sponsors for things that
  turned out to be our own misreading of their documentation. I asked whether we
  were certain it was their problem; both claims were withdrawn after checking.
- **Reading source instead of querying the chain**, corrected mid-outage.
- **A controller that mistook deposits for yield.** Its first version measured
  portfolio growth, which counts an incoming deposit as income. I pushed back on
  the resulting behaviour until it measured share price instead, which deposits
  do not move.

## Responsibility summary

I am responsible for the architecture, the decisions about what to build and what
to refuse, the review of every change, and every transaction sent. The agent
accelerated analysis, implementation, testing and diagnosis within that. Where
this document describes something as verified, it was verified against the live
deployment; where it was not, the feedback file says so.
