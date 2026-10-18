/**
 * Shared-secret guard for every agent/tool endpoint.
 *
 * The ElevenLabs agent sends the secret in the X-DCP-Agent-Secret header.
 * It is compared in constant time against ELEVENLABS_WEBHOOK_SECRET.
 * Fails closed in EVERY environment (ported from storefront PR #45):
 * if the env var is unset, endpoints return 503 and do nothing.
 */
import { createHash, timingSafeEqual } from 'node:crypto'

export const AGENT_SECRET_HEADER = 'x-dcp-agent-secret'
export const AGENT_SECRET_ENV = 'ELEVENLABS_WEBHOOK_SECRET'

function digest(value: string): Uint8Array {
  return new Uint8Array(createHash('sha256').update(value, 'utf8').digest())
}

/** Constant-time comparison (hashing first equalizes lengths). */
export function secretsMatch(provided: string, expected: string): boolean {
  return timingSafeEqual(digest(provided), digest(expected))
}

export type GuardResult = { status: 401 | 405 | 503; error: string } | null

export function checkAgentRequest(
  req: { method: string; headers: Headers },
  options: { methods?: string[]; env?: Record<string, string | undefined> } = {}
): GuardResult {
  const methods = options.methods ?? ['POST']
  const env = options.env ?? process.env
  if (!methods.includes(req.method)) return { status: 405, error: 'Method not allowed' }

  const expected = (env[AGENT_SECRET_ENV] || '').trim()
  if (!expected) return { status: 503, error: 'Tool endpoint is not configured' }

  const provided = (req.headers.get(AGENT_SECRET_HEADER) || '').trim()
  if (!provided || !secretsMatch(provided, expected)) return { status: 401, error: 'Unauthorized' }
  return null
}

/** Best-effort client IP (Vercel sets x-real-ip / x-forwarded-for). */
/**
 * Client IP for rate limiting. Prefer x-vercel-forwarded-for: Vercel sets it to
 * the connecting client and it cannot be spoofed by the request. x-real-ip and
 * x-forwarded-for are fallible (and on Deployment Protection / share links can
 * flip between hops), which previously split one client across many limiter keys.
 */
/**
 * Rate-limit key for an IP. IPv6 clients commonly rotate addresses inside their
 * /64 (privacy addresses), so IPv6 is keyed by its /64 prefix; IPv4 as-is.
 */
export function rateLimitIpKey(ip: string): string {
  if (!ip.includes(':')) return ip
  const [head, tail] = ip.toLowerCase().split('::')
  const left = head ? head.split(':') : []
  const right = tail !== undefined && tail ? tail.split(':') : []
  const groups = tail !== undefined ? [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right] : left
  return groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, '') || '0').join(':') + '::/64'
}

export function getClientIp(headers: Headers): string {
  const vercel = headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim()
  if (vercel) return vercel
  const realIp = headers.get('x-real-ip')?.trim()
  if (realIp) return realIp
  const first = (headers.get('x-forwarded-for') || '').split(',')[0].trim()
  return first || 'unknown'
}
