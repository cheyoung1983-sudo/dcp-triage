import { NextResponse } from 'next/server'
import { getClientIp, rateLimitIpKey } from '@/lib/auth'
import { methodNotAllowed, readJson, toResponse } from '@/lib/http'
import { hashKey } from '@/lib/rate-limit'
import { createSharedLimiter } from '@/lib/shared-limit'
import { smartTriageTool } from '@/lib/tools/smart-triage'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Public, unauthenticated, deterministic. Shared limit (30 per 10 min per IP) via Upstash.
export const limiter = createSharedLimiter({ name: 'smart-triage', limit: 30, windowSeconds: 10 * 60, failOpen: true })

export async function POST(req: Request) {
  const via = req.headers.get('x-vercel-forwarded-for')?.trim()
    ? 'vercel'
    : req.headers.get('x-real-ip')?.trim()
      ? 'real'
      : req.headers.get('x-forwarded-for')?.trim()
        ? 'xff'
        : 'unknown'
  const ip = getClientIp(req.headers)
  const keyed = rateLimitIpKey(ip)
  const key = hashKey(keyed)
  const check = await limiter.consume(key)
  const rlHeaders: Record<string, string> = {
    'X-RateLimit-Limit': '30',
    'X-RateLimit-Remaining': String(check.remaining),
    'X-RateLimit-Source': check.source,
    // Short, non-reversible key prefix so stable per-client keying can be verified.
    'X-RateLimit-Key': key.slice(0, 8),
    'X-RateLimit-Ip-Via': via,
    'X-RateLimit-Ip-Family': ip.includes(':') ? 'v6' : 'v4',
    'X-RateLimit-Ip-Len': String(ip.length),
  }
  if (!check.allowed) {
    return NextResponse.json(
      { success: false, error: 'Too many requests' },
      { status: 429, headers: { ...rlHeaders, 'Retry-After': String(check.retryAfterSeconds) } },
    )
  }
  const body = await readJson(req)
  if (!body.ok) return body.response
  const result = toResponse(smartTriageTool(body.data))
  for (const [k, v] of Object.entries(rlHeaders)) result.headers.set(k, v)
  return result
}

export const GET = () => methodNotAllowed()
