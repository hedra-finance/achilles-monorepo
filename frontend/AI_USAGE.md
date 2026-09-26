# AI assistance and human direction in the Achilles frontend

This document covers AI assistance in the Achilles frontend and its supporting
application API routes only. It describes my direction as the frontend contributor,
the work I delegated, and where that work appears in the frontend. It is not a
project-wide account of AI usage or of other teammates' contributions.

I set the scope, selected the branding, specified user-facing requirements, and
reviewed the results through screenshots and hands-on use. The agent helped with
analysis, implementation, debugging, testing, and Git operations under that
direction. This was an iterative collaboration with the team; it was not an
independently AI-created project.

The file references below identify implementation areas that were reviewed or
modified with AI assistance. They do not imply that the agent authored every
line in those files, or that it created the team's original contracts and backend.

## How I directed the work

### Project understanding and scope

I explained the project context, team roles, hackathon timeline, and priorities.
I limited the agent's implementation scope to the frontend, UI/UX, branding, and
application API routes serving the frontend on Vercel.

I supplied teammates' code, architecture and World ID documentation, the pitch
deck, and technical explanations from the team. I asked the agent to compare
those materials with the current implementation and latest `main`, identify
missing connections, and translate the findings into frontend work. I also asked
it to review the hackathon and the World, Uniswap, and Curvegrid prize tracks to
help identify integration and presentation gaps. Research was an input to the
work, not evidence that a prize requirement had been satisfied.

### Branding and user experience

I requested naming and logo options, selected Achilles as the team and project
name, and supplied the approved logo and pitch-deck visuals as design references.
I required a consistent Achilles identity across the landing page and application.

I distinguished the landing page's explanatory role from the product page's
transactional role. When action screens became too long, I asked for fewer
redundant navigation buttons, more compact dashboard layouts, and explanations
moved into tooltips or collapsible sections where appropriate.

I also gave specific motion feedback: the floating logo felt unpolished, FAQ
expansion appeared abrupt, some tooltips lacked transitions, and expandable
sections needed clearer affordances and rotating arrows. The agent implemented
and revised those interactions in response.

### Frontend requirements and visual review

I specified the information users needed to see: source allocation, stock
holdings, stock prices, performance, and chain information. I requested stock
logos from TradingView and clarified that chain logos and names belonged beside
the allocation items, rather than only inside the chart.

I supplied screenshots showing clipped tabs, overflow, awkward spacing, and
unclear controls. When a reported fix did not resolve what I saw, I pointed to
the affected area again and requested another review. I also specified smaller
interaction details, such as prefilling the Junior invitation-code field with
`ETHGLOBAL` while keeping it editable.

### Integration debugging and recovery flows

I provided configuration information and instructed the agent to keep environment
values and credentials out of Git. When data was unavailable, I asked it to
identify the exact source and failing read instead of only describing the visual
symptom.

For World ID, I described the sequence I experienced: phone approval followed by
a web rejection, a later successful World UI result followed by a retry prompt,
and eventual recognition after another refresh. I supplied an approximate time,
the deployment, and the affected wallet for investigation. Those diagnostic values
are not reproduced here.

I asked the agent to check official documentation and relevant cases, distinguish
proof-verification failures from delayed access updates, and make the flow usable
without repeated scans. The resulting changes separate proof verification,
registration, and permission propagation, with status polling and a recovery path
for an already registered wallet.

### Verification and release discipline

I required more than code changes: type checking, builds, tests, browser checks,
and review of the complete user flow. I supplied deployment screenshots and logs
when Vercel behavior did not match expectations.

I directed branch creation, updates from `main`, rebasing, conflict resolution,
signed commits, and pushes. I also asked for remote confirmation rather than
assuming a successful local commit meant the change was published. When Git or
working-directory state was unexpected, I provided terminal output and asked the
agent to resolve it.

### Continuity and temporary decisions

I asked the agent to retain decisions, constraints, deferred tasks, and temporary
changes so later work could continue with the same context. Temporary display
changes were recorded with restoration instructions outside the repository.

These included displaying confirmed missing historical prices as zero,
temporarily hiding a historical-price error notice, and using a fixed Junior
rate with an illustrative chart for a testnet presentation. These are display
workarounds, not fixes to contract economics or evidence of actual returns.

## Where AI assistance was applied

| Application area | My direction and the agent's contribution | Implementation references |
| --- | --- | --- |
| Landing page `/` | I provided the visual direction and requested a distinct introductory page. The agent worked on the layout, yield-source explanation, and risk-layer interactions. | [Landing](src/components/Landing.tsx), [YieldFlow](src/components/YieldFlow.tsx), [landing styles](src/app/landing.css) |
| Logo and hero animation | I rejected the floating-logo treatment and requested a short loop or better interaction. The implementation includes a video surface, poster fallback, and motion controls using the approved logo. | [LogoSurface](src/components/LogoSurface.tsx), [Brand](src/components/Brand.tsx), [logo video](public/brand/achilles-loop.mp4) |
| Product directory `/products` | I requested comparable product and asset information. The agent worked on list/card views, search, asset logos, and investment guidance. | [ProductCatalog](src/components/ProductCatalog.tsx), [products page](src/app/products/page.tsx) |
| Product workspace `/products/stocks-stable` | I requested fewer redundant buttons and less scrolling. The agent reorganized research tabs and the investment area and adjusted responsive layouts. | [ProductDetail](src/components/ProductDetail.tsx), [dashboard styles](src/app/dashboard.css) |
| Allocation and holdings | I specified allocation charts, holdings, stock logos, and chain information beside individual sources. The agent connected those views and addressed clipping and overflow. | [Allocation](src/components/Allocation.tsx), [DistributionChart](src/components/DistributionChart.tsx), [StockLogo](src/components/StockLogo.tsx), [ChainBadge](src/components/ChainBadge.tsx) |
| Prices and performance | I requested clear stock-price and performance views. The agent worked on settlement-based chart display and yield presentation. The temporary Junior override is listed separately below. | [StockPricesChart](src/components/StockPricesChart.tsx), [NavChart](src/components/NavChart.tsx), [strategy snapshot](src/hooks/strategy.ts) |
| Deposit and redemption ticket | I requested a compact action flow. The agent worked on amount entry, prerequisites, estimates, requests, and transaction-state handling. | [Ticket](src/components/Ticket.tsx), [writes](src/lib/writes.ts), [position actions](src/lib/position-actions.ts) |
| Wallet preparation and Junior access | I specified connection, network, funding, and invitation-code behavior. The agent worked on the preparation steps, funding API connections, and editable default code. | [Access](src/components/Access.tsx), [wallet configuration](src/lib/wagmi.ts), [faucet API](src/app/api/faucet/route.ts), [gas API](src/app/api/gas/route.ts) |
| World ID and access recovery | I supplied the repeated-verification incident and requested a smooth recovery flow. The agent updated proof handling, status polling, pending-state recovery, and signed continuation for registered wallets. | [WorldVerification](src/components/WorldVerification.tsx), [access flow](src/lib/access-flow.ts), [proof validation](src/lib/human-proof.ts), [World ID API](src/app/api/worldid/route.ts), [whitelist API](src/app/api/whitelist/route.ts), [access status API](src/app/api/access-status/route.ts) |
| Pool activity and `/activity` | I asked the agent to check the team's MultiBaas description against the implementation. It reviewed and improved category queries, current-deployment filtering, event display, and error states. | [PoolActivity](src/components/PoolActivity.tsx), [activity page](src/app/activity/page.tsx), [MultiBaas API](src/app/api/multibaas/route.ts), [indexed events](src/lib/indexed-events.ts) |
| Portfolio and settlement history | I asked for the flow after investment to be reviewed as well. The agent worked on account reads, positions, settlement history, and claim-related frontend handling. | [portfolio page](src/app/portfolio/page.tsx), [SettlementHistory](src/components/SettlementHistory.tsx), [data hooks](src/hooks/data.ts), [chain reads](src/lib/reads.ts) |
| FAQ, tooltips, transitions, and loading | I identified abrupt expansion, missing transitions, and unclear controls. The agent revised shared motion, navigation, tooltips, and loading components. | [FaqItem](src/components/FaqItem.tsx), [HelpTip](src/components/HelpTip.tsx), [Motion](src/components/Motion.tsx), [MotionLink](src/components/MotionLink.tsx), [Skeleton](src/components/Skeleton.tsx) |
| Temporary Junior presentation | I requested a fixed 23.4% testnet rate and a nearby fluctuating series. The agent isolated this presentation override from real share prices, balances, and transaction calculations. | [Junior display configuration](src/lib/junior-display.ts), [JuniorTestnetChart](src/components/JuniorTestnetChart.tsx) |

## World ID example from feedback to implementation

The reported incident led to changes across multiple layers, not just an error message:

1. `Access.tsx` obtains a fresh request context from `/api/worldid` and opens
   `WorldVerification.tsx`.
2. The proof is submitted to `/api/whitelist` for server verification and the
   registration and permission steps.
3. `/api/access-status` checks registration, the Hub grant, and the relevant
   Sepolia transfer restriction.
4. The frontend displays pending status, polls for completion, and refreshes
   account data. A registered wallet can sign a scoped request to resume setup
   without another World ID scan.
5. The investment ticket still checks actual account eligibility and other
   transaction prerequisites before enabling the action.

This illustrates the collaboration pattern: I supplied the observed failure and
expected experience; the agent investigated the implementation and made the
corresponding frontend and API changes.

## Work outside application code

- **Research and design discussions:** project analysis, naming and logo options,
  pitch-deck review, and integration research informed implementation choices.
  Not every discussion resulted in a repository file.
- **Deployment configuration:** Vercel build logs, root-directory and framework
  settings, and environment configuration were inspected separately from source
  changes. A Git push and a successful production deployment were treated as
  different checks.
- **Git operations:** the agent performed directed commits, signature checks,
  rebases, pushes, and remote-state verification.
- **Testing:** frontend tests cover calculations, proof validation, partial reads,
  and transaction-state handling. Additional browser and route checks were run
  during development. Mocked failure/recovery tests, live read checks, and a real
  phone verification are distinct forms of evidence; none alone proves the full
  deposit-to-redemption flow.
- **Private continuity notes:** decisions, deferred tasks, investigation evidence,
  and temporary-change restoration instructions were maintained outside Git.

## Selected traceable changes

| Commit | Change | Human direction |
| --- | --- | --- |
| `eb6cbbe` | World ID access recovery and refresh flow | Investigate repeated verification and let users continue smoothly after registration. |
| `6461c50` | Default Junior invitation code | Prefill the invitation field with ETHGLOBAL and keep it editable. |
| `5c947cf` | Temporary Junior testnet rate and chart | Display 23.4% with an illustrative series and preserve a way to restore recorded performance. |

For the temporary Junior presentation, setting `JUNIOR_TESTNET_OVERRIDE` to
`false` in [junior-display.ts](src/lib/junior-display.ts) restores the
recorded yield display and the original Junior performance chart. The fixed rate
and illustrative series must not be interpreted as observed on-chain returns.

## Responsibility summary

I directed scope, priorities, branding choices, required information, interaction
behavior, and acceptance criteria. I reviewed the application and supplied
concrete feedback when the result did not meet those expectations. The AI agent
provided implementation assistance, analysis, verification, and repository
operations in response. Teammates' contract and backend contributions remained
part of the underlying system, rather than being attributed to the agent.
