import { parseAbi, type Address } from 'viem'
import { client } from './chains'
import { PRODUCT } from './product'

const abi = parseAbi([
  'function manager() view returns (address)',
  'function productOfVault(address) view returns (uint64)',
  'function productOf(uint64) view returns (bool registered, bool productPaused, uint8 trancheCount, address allocator, uint256 minRequest)'
])

/** The shared coordinator stores entry limits per product. Routing/settlement can impose other limits. */
export async function requestLimits(chainId: number, vault: Address) {
  const pub = client(chainId)
  const manager = await pub.readContract({
    address: vault,
    abi,
    functionName: 'manager'
  })
  const [productId, product] = await Promise.all([
    pub.readContract({
      address: manager,
      abi,
      functionName: 'productOfVault',
      args: [vault]
    }),
    pub.readContract({
      address: manager,
      abi,
      functionName: 'productOf',
      args: [PRODUCT.id]
    })
  ])
  if (productId !== PRODUCT.id || !product[0] || product[1])
    throw new Error('Product requests are unavailable.')
  // The router now promotes transfers below its carrier minimum. Its sponsored fee cap
  // is no longer a user deposit floor; enforce the coordinator's configured product limit.
  return { deposit: product[4], redeem: product[4] }
}
