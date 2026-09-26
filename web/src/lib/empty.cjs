// Stand-in for an optional dependency (x402) pulled in by a wallet SDK we don't use. CommonJS so the bundler can't
// statically check named exports against it.
module.exports = new Proxy({}, { get: (_, k) => (k === '__esModule' ? false : () => { throw new Error('x402 is not bundled in this app') }) })
