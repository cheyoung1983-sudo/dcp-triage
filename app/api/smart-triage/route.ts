import { NextResponse } from 'next/server'
import { getClientIp } from '@/lib/auth'
import { methodNotAllowed, readJson, toResponse } from '@/lib/http'
import { createWindowLimiter, hashKey } from '@/lib/rate-limit'
import { smartTriageTool } from '@/lib/tools/smart-triage'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Public, unauthenticated, deterministic. Per-instance rate limit.
const limiter = createWindowLimiter({ limit: 30, windowMs: 10 * 60 * 1000 })

export async function POST(req: Request) {
  const check = limiter.consume(hashKey(getClientIp(req.headers)))
  if (!check.allowed) {
    return NextResponse.json({ success: false, error: 'Too many requests' }, { status: 429, headers: { 'Retry-After': String(check.retryAfterSeconds) } })
  }
  const body = await readJson(req)
  if (!body.ok) return body.response
  return toResponse(smartTriageTool(body.data))
}

export const GET = () => methodNotAllowed()
