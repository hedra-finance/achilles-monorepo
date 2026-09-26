import { parseAbi } from 'viem'

export const shareRestrictionAbi = parseAbi([
  'function detectTransferRestriction(address from, address to, uint256 value) view returns (uint8)'
])

export const PRECOMPILE = {
  trancheSystem: '0x0000000000000000000000000000000000000200',
  investments: '0x0000000000000000000000000000000000000201',
  permissions: '0x0000000000000000000000000000000000000202',
  txRegistry: '0x0000000000000000000000000000000000000203'
} as const

export const trancheSystemAbi = parseAbi([
  'struct VaultInput { uint64 chain_id; address vault_address; }',
  'struct TrancheInput { uint8 tranche_type; uint256 apr; VaultInput vault; address asset; address shares; uint8 priority; }',
  'struct CollateralInput { uint64 chain_id; address nft_contract; uint256 nft_token_id; }',
  'struct AdapterInput { uint8 source_type; address source_address; uint16 weightBps; address borrower; CollateralInput[] collaterals; }',
  'struct MultichainAdapterInput { address adapter_address; uint64 chain_id; uint16 weightBps; AdapterInput[] adapters; }',
  'function get_product(uint64 product_id) view returns (address base_asset, address valuation, uint64 settlement_start_timestamp, uint64 settlement_length_secs, uint64 settlement_offset_secs)',
  'function get_tranches(uint64 product_id) view returns (TrancheInput[] tranches)',
  'function get_multichain_adapters(uint64 product_id) view returns (MultichainAdapterInput[] multichain_adapters)'
])

export const investmentsAbi = parseAbi([
  'struct TrancheSettle { uint64 vault_chain_id; address vault_address; uint256 tranche_nav; uint256 share_price; uint256 units_outstanding; uint256 principal; }',
  'struct AssetPosition { address asset; uint256 amount; uint256 priceUsd; uint256 usdValue; bool counted; }',
  'struct AdapterValuation { uint64 chainId; address adapter; uint256 epochId; uint64 valuationCutoff; uint256 principal; AssetPosition[] positions; }',
  'struct ChainSettlement { uint64 chain_id; uint256[] share_prices; uint256[] tranche_navs; }',
  'struct SettlementStateEntry { uint256 settlement_id; TrancheSettle[] tranches; uint256 pending_deposit_assets; uint256 product_nav; uint256 recorded_at; uint256 timestamp; }',
  'function get_settlement_id(uint64 product_id) view returns (uint256)',
  'function get_last_settlement(uint64 product_id) view returns (uint256 settlement_id, ChainSettlement[] chains, uint256 product_nav)',
  'function get_settlement_state(uint64 product_id, uint256 settlement_id) view returns (TrancheSettle[] tranches, uint256 pending_deposit_assets, uint256 product_nav, uint256 recorded_at, uint256 timestamp)',
  'function get_settlement_states(uint64 product_id, uint256 offset, uint256 limit) view returns (SettlementStateEntry[] entries, uint256 total)',
  'function get_adapter_valuations(uint64 product_id, uint256 settlement_id) view returns (AdapterValuation[] valuations)',
  'function get_request(uint64 product_id, bytes32 request_id) view returns (address investor, uint64 vault_chain_id, address vault, uint256 amount, uint256 settlement_id, uint8 order_type, uint8 status)'
])

export const permissionsAbi = parseAbi([
  'struct VaultInput { uint64 chain_id; address vault_address; }',
  'function is_tranche_investor(uint64 product_id, VaultInput vault, address who) view returns (bool)',
  'function grant_permission(uint64 product_id, uint8 role, address who, VaultInput vault)'
])

export const txRegistryAbi = parseAbi([
  'struct VaultInput { uint64 chain_id; address vault_address; }',
  'struct InvestorRequest { uint64 product_id; bytes32 request_id; }',
  'struct TxRecord { uint64 chain_id; bytes32 tx_hash; uint256 recorded_at; }',
  'struct RequestTxStep { uint8 step; TxRecord tx; }',
  'struct AdapterLeg { uint64 chain_id; RequestTxStep[] steps; }',
  'struct RequestInfo { address investor; VaultInput vault; uint256 amount; uint8 order_type; }',
  'struct SettlementChainSteps { uint64 spoke_chain_id; RequestTxStep[] steps; }',
  'struct ReceiveHistoryEntry { VaultInput vault; bytes32 tx_hash; }',
  'struct BridgeAttempt { uint8 status; TxRecord tx; }',
  'struct ChainBridgeAttempts { uint64 chain_id; BridgeAttempt[] attempts; }',
  'struct SettlementChainBridgeAttempts { uint64 spoke_chain_id; BridgeAttempt[] collect_attempts; BridgeAttempt[] response_attempts; BridgeAttempt[] finalize_attempts; }',
  'struct RequestDetails { bytes32 request_id; bool found; RequestInfo info; RequestTxStep[] request_steps; AdapterLeg[] adapter_legs; uint8 status; uint256 settlement_id; bool settled; BridgeAttempt[] request_bridge_attempts; ChainBridgeAttempts[] adapter_bridge_attempts; }',
  'function get_investor_active_requests(address investor) view returns (InvestorRequest[] requests)',
  'function get_investor_request_history(address investor, uint64 product_id, uint256 offset, uint256 limit) view returns (bytes32[] request_ids, uint256 total)',
  'function get_investor_receive_history(address investor, uint64 product_id, uint256 offset, uint256 limit) view returns (ReceiveHistoryEntry[] receives, uint256 total)',
  'function get_receive(address investor, VaultInput vault, bytes32 tx_hash) view returns (address receiver, uint256 amount, uint8 kind, TxRecord tx)',
  'function get_requests(uint64 product_id, bytes32[] request_ids) view returns (RequestDetails[] entries)',
  'function get_settlement(uint64 product_id, uint256 settlement_id) view returns (TxRecord settle_started_tx, uint8 status, SettlementChainSteps[] spoke_chains, SettlementChainBridgeAttempts[] spoke_bridge_attempts)'
])

// Spoke vault (ERC-7540). The custom errors must be listed here so simulation can decode them by name.
export const vaultAbi = parseAbi([
  'function requestDeposit(uint256 assets, address controller, address owner) returns (uint256)',
  'function requestRedeem(uint256 shares, address controller, address owner) returns (uint256)',
  'function deposit(uint256 assets, address receiver) returns (uint256)',
  'function redeem(uint256 shares, address receiver, address controller) returns (uint256)',
  'function pendingDepositRequest(uint256, address) view returns (uint256)',
  'function claimableDepositRequest(uint256, address) view returns (uint256)',
  'function pendingRedeemRequest(uint256, address) view returns (uint256)',
  'function claimableRedeemRequest(uint256, address) view returns (uint256)',
  'event DepositRequest(address indexed controller, address indexed owner, uint256 indexed requestId, address sender, uint256 assets)',
  'event RedeemRequest(address indexed controller, address indexed owner, uint256 indexed requestId, address sender, uint256 shares)',
  'error DepositRestricted(uint8 code)',
  'error BelowMinRequest()',
  'error ZeroAmount()',
  'error EnforcedPause()',
  'error InvalidController()',
  'error NotController()',
  'error ClaimMismatch()',
  'error NothingClaimable()',
  'error NotSettled()',
  'error WrongProduct()',
  'error AssetMismatch()',
  'error BadTranche()',
  'error OverCapacity()'
])

export const erc20Abi = parseAbi([
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)'
])

export const basketAdapterAbi = parseAbi([
  'function basketCount() view returns (uint256)',
  'function basket(uint256) view returns (address token, address pool, uint16 weightBps, uint24 fee)',
  'function totalAssets() view returns (uint256)'
])
export const uniV3PoolAbi = parseAbi([
  'function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 a, uint16 b, uint16 c, uint8 d, bool e)',
  'function token0() view returns (address)'
])
export const lpAdapterAbi = parseAbi([
  'function totalAssets() view returns (uint256)',
  'function lpValue() view returns (uint256)'
])
export const uniV2PoolAbi = parseAbi([
  'function getReserves() view returns (uint112, uint112, uint32)',
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address) view returns (uint256)'
])
export const adapterNameAbi = parseAbi([
  'function name() view returns (string)'
])

/** Testnet asset: the faucet route mints it, so keep mint out of the ABI the UI reads with. */
export const mintableErc20Abi = parseAbi([
  'function decimals() view returns (uint8)',
  'function balanceOf(address) view returns (uint256)',
  'function mint(address to, uint256 amount)',
])


export const humanRegistryAbi = parseAbi([
  'function claim(uint256 nullifierHash, address wallet)',
  'function isVerified(address) view returns (bool)',
  'function walletOf(uint256) view returns (address)',
  'function nullifierOf(address) view returns (uint256)',
  'error HumanAlreadyClaimed(address existingWallet)',
  'error WalletAlreadyClaimed(uint256 existingNullifier)',
  'error NotVerifier()',
  'error ZeroValue()',
])
