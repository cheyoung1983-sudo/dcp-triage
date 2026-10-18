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
export function getClientIp(headers: Headers): string {
  const realIp = headers.get('x-real-ip')
  if (realIp?.trim()) return realIp.trim()
  const first = (headers.get('x-forwarded-for') || '').split(',')[0].trim()
  return first || 'unknown'
}
