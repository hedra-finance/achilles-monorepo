import { PRODUCT } from '@/lib/product'

// Brand glyphs from Simple Icons; network labels distinguish testnet capital from entry chains.
export function sourceChain(chainId: number) {
  if (chainId === PRODUCT.robinhood.chainId)
    return { name: 'Robinhood Testnet', logo: '/chains/robinhood.svg' }
  if (chainId === PRODUCT.sepolia.chainId)
    return { name: 'Ethereum Sepolia', logo: '/chains/ethereum.svg' }
  return null
}

export function ChainBadge({ chainId }: { chainId: number }) {
  const chain = sourceChain(chainId)
  return (
    <span className="source-chain">
      {chain && <img src={chain.logo} width={16} height={16} alt="" />}
      <span>{chain?.name ?? `Chain ${chainId}`}</span>
    </span>
  )
}
