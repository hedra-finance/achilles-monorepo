/**
 * Development instrumentation. Next forwards the browser console and unhandled rejections to the
 * terminal, so everything here is a console call rather than a second logging channel — one tail on
 * the dev server log shows the server and the browser together.
 *
 * Tagged `[app]` so it can be grepped apart from framework and wallet-library noise.
 */
const TAG = '[app]'

let installed = false
/** Posted rather than only logged: Next's console forwarding drops messages, and this must not. */
let native: typeof fetch | null = null
/**
 * Wallet libraries call analytics and identity endpoints that fail routinely — blocked by the browser,
 * or queried with an address that does not exist yet. Those are not this app's errors, and routing them
 * to console.error puts a red overlay over the page for something nobody can fix. They still reach the
 * server log, where they are occasionally useful; they just do not interrupt.
 */
const THIRD_PARTY = /walletconnect\.org|web3modal\.org|coinbase\.com|reown\.com|cca-lite/i

function report(level: 'error' | 'warn', ...parts: unknown[]) {
  if (process.env.NODE_ENV === 'production') return
  const line = [TAG, ...parts]
  const noisy = parts.some((p) => typeof p === 'string' && THIRD_PARTY.test(p))
  if (noisy) console.debug(...line)
  else if (level === 'error') console.error(...line)
  else console.warn(...line)
  // The unpatched fetch, so reporting a failed request cannot recurse into itself.
  void (native ?? fetch)('/api/log', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ level: noisy ? 'warn' : level, parts: line.map((p) => (typeof p === 'string' ? p : String(p))) }),
  }).catch(() => {})
}

export function installDevLog(): void {
  if (installed || typeof window === 'undefined' || process.env.NODE_ENV === 'production') return
  installed = true

  native = window.fetch.bind(window)
  const where = () => `${location.pathname}${location.search}`

  window.addEventListener('error', (e) => {
    report('error', 'uncaught', where(), e.message, e.filename ? `${e.filename}:${e.lineno}` : '')
  })
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason as { message?: string; shortMessage?: string; stack?: string } | string
    const text = typeof r === 'string' ? r : (r?.shortMessage ?? r?.message ?? String(r))
    report('error', 'unhandled rejection', where(), text)
  })

  // Non-2xx and network failures. The UI turns these into states; the log keeps the cause.
  const original = window.fetch
  window.fetch = async (...args: Parameters<typeof fetch>) => {
    const url = typeof args[0] === 'string' ? args[0] : ((args[0] as Request).url ?? String(args[0]))
    const started = performance.now()
    try {
      const res = await original(...args)
      const ms = Math.round(performance.now() - started)
      // RPC calls answer 200 with a JSON-RPC error inside, which is the failure mode that actually
      // bites here — a read that "succeeds" and returns nothing usable.
      // A 4xx from our own API is the server saying no on purpose — a wrong invite code, a nullifier
      // already claimed. The UI shows that to the person; raising it as an error would put a red overlay
      // over a working flow. Only failures nobody asked for are errors.
      if (!res.ok) report(res.status >= 400 && res.status < 500 ? 'warn' : 'error', 'fetch', res.status, url, `${ms}ms`)
      else if (ms > 5000) report('warn', 'slow fetch', url, `${ms}ms`)
      return res
    } catch (e) {
      report('error', 'fetch failed', url, `${Math.round(performance.now() - started)}ms`, String(e))
      throw e
    }
  }
}

/** Query/mutation failures, from the QueryClient caches. Attach once, next to the client. */
export function queryLogHandlers() {
  return {
    onQueryError: (key: readonly unknown[], error: unknown) =>
      report('error', 'query failed', JSON.stringify(key), describe(error)),
    onMutationError: (error: unknown) => report('error', 'mutation failed', describe(error)),
  }
}

function describe(e: unknown): string {
  if (!e || typeof e !== 'object') return String(e)
  const o = e as { shortMessage?: string; message?: string; cause?: unknown }
  return [o.shortMessage ?? o.message, o.cause ? describe(o.cause) : ''].filter(Boolean).join(' <- ')
}
