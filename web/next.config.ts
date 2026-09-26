import type { NextConfig } from 'next'

// wagmi's Base Account connector pulls in Coinbase's SDK, which imports the x402 package as an optional dependency.
// We don't use x402, so it's aliased to an empty module — the build passes without installing it.
const stub = './src/lib/empty.cjs'
const STUBS = [
  '@x402/core/client',
  '@x402/core',
  '@x402/evm',
  '@x402/evm/exact/client',
  '@x402/evm/upto/client',
  '@x402/svm/upto/client',
  '@x402/extensions',
  '@x402/svm',
  '@x402/svm/exact/client'
]

const config: NextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 's3-symbol-logo.tradingview.com',
        pathname: '/**'
      }
    ]
  },
  transpilePackages: ['achilles-contracts'],
  turbopack: { resolveAlias: Object.fromEntries(STUBS.map((s) => [s, stub])) },
  webpack: (c) => {
    c.resolve.alias = {
      ...c.resolve.alias,
      ...Object.fromEntries(STUBS.map((s) => [`${s}$`, require.resolve(stub)]))
    }
    return c
  }
}
export default config
