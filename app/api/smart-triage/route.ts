import { NextResponse } from 'next/server'
import { getClientIp } from '@/lib/auth'
import { methodNotAllowed, readJson, toResponse } from '@/lib/http'
import { hashKey } from '@/lib/rate-limit'
import { createSharedLimiter } from '@/lib/shared-limit'
import { smartTriageTool } from '@/lib/tools/smart-triage'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Public, unauthenticated, deterministic. Shared limit (30 per 10 min per IP) via Upstash.
export const limiter = createSharedLimiter({ name: 'smart-triage', limit: 30, windowSeconds: 10 * 60 })

export async function POST(req: Request) {
  const check = await limiter.consume(hashKey(getClientIp(req.headers)))
  if (!check.allowed) {
    return NextResponse.json({ success: false, error: 'Too many requests' }, { status: 429, headers: { 'Retry-After': String(check.retryAfterSeconds) } })
  }
  const body = await readJson(req)
  if (!body.ok) return body.response
  return toResponse(smartTriageTool(body.data))
}

export const GET = () => methodNotAllowed()
