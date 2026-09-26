import dep from 'achilles-contracts/deployments/eg_deploy.json'
import type { Address, Hex } from 'viem'

/** Only what the front needs from the deployment record (contracts/deployments/eg_deploy.json). Tranches are read from the hub. */
export const PRODUCT = {
  id: BigInt(dep.productId),
  idHex: dep.productId as Hex,
  name: 'Stocks & Stable LP',
  hubChainId: dep.hub.chainId,
  robinhood: {
    chainId: dep.spoke.chainId,
    basketAdapter: dep.spoke.basketAdapter as Address,
    basket: dep.spoke.basket as {
      symbol: string
      name: string
      weightBps: number
      token: string
      pool?: string
    }[]
  },
  sepolia: {
    chainId: dep.sepolia.chainId,
    usdc: dep.sepolia.usdc as Address,
    lpAdapter: dep.sepolia.lpAdapter as Address,
    pool: dep.sepolia.pool as Address,
    usdt: dep.sepolia.usdt as Address,
    humanRegistry: dep.sepolia.humanRegistry as Address
  },
  /** User deposit entry point — Sepolia only. The other network runs capital; its technical vaults are not user entry points. */
  vaults: {
    [dep.sepolia.chainId]: {
      sr: dep.sepolia.vaultSr as Address,
      jr: dep.sepolia.vaultJr as Address
    }
  } as Record<number, { sr: Address; jr: Address }>,
  entryChains: [dep.sepolia.chainId] as number[],
  weights: {
    [dep.spoke.chainId]: dep.weights.spoke,
    [dep.sepolia.chainId]: dep.weights.sepolia
  } as Record<number, number>
} as const
