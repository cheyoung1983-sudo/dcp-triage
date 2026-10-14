/**
 * Shared fixed-window rate limiter backed by Upstash Redis REST.
 * Counters are shared across Vercel instances via INCR + EXPIRE NX.
 *
 * - No KV/Upstash env → per-instance memory limiter (logged once), for local/test.
 * - Redis error while KV is configured:
 *     failOpen: true  (smart-triage) → allow + warn every time
 *     failOpen: false (dispatch-sms) → deny 429 + error every time
 */
import { getUpstashConfig, type UpstashConfig } from './store/upstash'
import { createWindowLimiter, type WindowLimiter } from './rate-limit'

export interface LimitDecision {
  allowed: boolean
  remaining: number
  retryAfterSeconds: number
  source: 'redis' | 'memory' | 'open' | 'closed'
}

export interface SharedLimiter {
  consume(key: string): Promise<LimitDecision>
  reset(): void
}

interface Options {
  name: string
  limit: number
  windowSeconds: number
  /** When Redis errors with KV configured: allow (true) or deny (false). */
  failOpen: boolean
  env?: Record<string, string | undefined>
  fetchImpl?: typeof fetch
  now?: () => number
}

let missingEnvLogged = new Set<string>()

async function redisConsume(
  config: UpstashConfig,
  fetchImpl: typeof fetch,
  bucketKey: string,
  limit: number,
  windowSeconds: number,
): Promise<LimitDecision> {
  const res = await fetchImpl(`${config.url}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([
      ['INCR', bucketKey],
      ['EXPIRE', bucketKey, windowSeconds, 'NX'],
      ['TTL', bucketKey],
    ]),
    signal: AbortSignal.timeout(4_000),
  })
  if (!res.ok) throw new Error(`rate limit store responded ${res.status}`)
  const out = (await res.json()) as { result?: unknown; error?: string }[]
  if (!Array.isArray(out)) throw new Error('rate limit store returned non-array')
  const failed = out.find((r) => r && r.error)
  if (failed) throw new Error(`rate limit store command failed: ${failed.error}`)
  const count = Number(out[0]?.result ?? 0)
  if (!Number.isFinite(count) || count < 1) throw new Error(`rate limit store returned bad count: ${String(out[0]?.result)}`)
  const ttl = Number(out[2]?.result ?? -1)
  const retryAfterSeconds = ttl > 0 ? ttl : windowSeconds
  if (count > limit) {
    return { allowed: false, remaining: 0, retryAfterSeconds, source: 'redis' }
  }
  return { allowed: true, remaining: Math.max(0, limit - count), retryAfterSeconds: 0, source: 'redis' }
}

export function createSharedLimiter(options: Options): SharedLimiter & { memory: WindowLimiter } {
  const { name, limit, windowSeconds, failOpen } = options
  const memory = createWindowLimiter({
    limit,
    windowMs: windowSeconds * 1000,
    now: options.now,
  })
  const env = () => options.env ?? process.env

  return {
    memory,
    async consume(key) {
      const config = getUpstashConfig(env())
      if (!config) {
        if (!missingEnvLogged.has(name)) {
          missingEnvLogged.add(name)
          console.error(`[dcp-triage] rate limiter "${name}" is per-instance only (no KV_REST_API_URL/UPSTASH_REDIS_REST_URL configured); shared limits are not enforced`)
        }
        const d = memory.consume(key)
        return { ...d, source: 'memory' }
      }
      const bucket = Math.floor((options.now?.() ?? Date.now()) / 1000 / windowSeconds)
      const bucketKey = `dcp:rl:${name}:${key}:${bucket}`
      try {
        return await redisConsume(config, options.fetchImpl ?? fetch, bucketKey, limit, windowSeconds)
      } catch (err) {
        const reason = (err as Error).message || 'redis error'
        if (failOpen) {
          console.warn(`[dcp-triage] rate limiter "${name}" redis error (${reason}); fail-open allowing request`)
          return { allowed: true, remaining: 0, retryAfterSeconds: 0, source: 'open' }
        }
        console.error(`[dcp-triage] rate limiter "${name}" redis error (${reason}); fail-closed denying request`)
        return { allowed: false, remaining: 0, retryAfterSeconds: 60, source: 'closed' }
      }
    },
    reset() {
      memory.reset()
      missingEnvLogged.delete(name)
    },
  }
}
