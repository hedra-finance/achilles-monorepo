import { NextResponse } from 'next/server'

/**
 * Development-only sink for browser-side diagnostics. Next's console forwarding is not dependable —
 * some messages reach the terminal and some do not — so anything we want to be able to rely on while
 * testing is posted here and printed server-side, where one tail sees it.
 *
 * Disabled outside development: it exists to be read by whoever is running the dev server.
 */
export async function POST(req: Request) {
  if (process.env.NODE_ENV === 'production') return new NextResponse(null, { status: 404 })
  const { level, parts } = (await req.json().catch(() => ({}))) as {
    level?: 'error' | 'warn' | 'info'
    parts?: unknown[]
  }
  const line = ['[browser]', ...(parts ?? []).map((p) => (typeof p === 'string' ? p : JSON.stringify(p)))].join(' ')
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
  return NextResponse.json({ ok: true })
}
