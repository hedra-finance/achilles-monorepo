import { parseAbi, type Address } from 'viem'
import { client } from './chains'
import { PRODUCT } from './product'

const abi = parseAbi([
  'function manager() view returns (address)',
  'function minRequest() view returns (uint256)',
  'function maxTxFeeOf(uint64) view returns (uint256)'
])

/** Entry-chain checks only; destination routing and settlement can impose other limits. */
export async function requestLimits(chainId: number, vault: Address) {
  const pub = client(chainId)
  const manager = await pub.readContract({
    address: vault,
    abi,
    functionName: 'manager'
  })
  const [minimum, bridgeFee] = await Promise.all([
    pub.readContract({ address: manager, abi, functionName: 'minRequest' }),
    pub.readContract({
      address: manager,
      abi,
      functionName: 'maxTxFeeOf',
      args: [PRODUCT.id]
    })
  ])
  return {
    deposit: minimum > bridgeFee ? minimum : bridgeFee + 1n,
    redeem: minimum,
    bridgeFee
  }
}
