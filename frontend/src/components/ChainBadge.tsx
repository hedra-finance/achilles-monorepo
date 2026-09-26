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
  return chain ? (
    <img
      className="source-chain-logo"
      src={chain.logo}
      width={24}
      height={24}
      alt=""
    />
  ) : null
}
