/**
 * Shared fixed-window rate limiter backed by Upstash Redis REST.
 * Uses a fixed window (INCR + EXPIRE) so counters are shared across Vercel
 * instances. Falls back to the per-instance in-memory limiter when no
 * KV/Upstash env is configured, and logs that fallback once.
 */
import { getUpstashConfig, type UpstashConfig } from './store/upstash'
import { createWindowLimiter, type WindowLimiter } from './rate-limit'

export interface LimitDecision {
  allowed: boolean
  remaining: number
  retryAfterSeconds: number
  /** 'redis' when enforced in the shared store, 'memory' when using the fallback. */
  source: 'redis' | 'memory'
}

export interface SharedLimiter {
  consume(key: string): Promise<LimitDecision>
  reset(): void
}

interface Options {
  name: string
  limit: number
  windowSeconds: number
  env?: Record<string, string | undefined>
  fetchImpl?: typeof fetch
  now?: () => number
}

let fallbackLogged = false

function logFallback(name: string, reason: string) {
  if (fallbackLogged) return
  fallbackLogged = true
  console.error(`[dcp-triage] rate limiter "${name}" is per-instance only (${reason}); shared limits are not enforced`)
}

/** Fixed-window counter in Redis: INCR the bucket key, set expiry on first hit. */
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
  if (out.some((r) => r.error)) throw new Error('rate limit store command failed')
  const count = Number(out[0]?.result ?? 0)
  const ttl = Number(out[2]?.result ?? -1)
  const retryAfterSeconds = ttl > 0 ? ttl : windowSeconds
  if (count > limit) {
    return { allowed: false, remaining: 0, retryAfterSeconds, source: 'redis' }
  }
  return { allowed: true, remaining: Math.max(0, limit - count), retryAfterSeconds: 0, source: 'redis' }
}

export function createSharedLimiter(options: Options): SharedLimiter & { memory: WindowLimiter } {
  const { name, limit, windowSeconds } = options
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
        logFallback(name, 'no KV_REST_API_URL/UPSTASH_REDIS_REST_URL configured')
        const d = memory.consume(key)
        return { ...d, source: 'memory' }
      }
      const bucket = Math.floor((options.now?.() ?? Date.now()) / 1000 / windowSeconds)
      const bucketKey = `dcp:rl:${name}:${key}:${bucket}`
      try {
        return await redisConsume(config, options.fetchImpl ?? fetch, bucketKey, limit, windowSeconds)
      } catch (err) {
        // A shared-store outage must not silently remove the limit.
        console.error(`[dcp-triage] shared rate limiter "${name}" failed, using per-instance fallback: ${(err as Error).message}`)
        const d = memory.consume(key)
        return { ...d, source: 'memory' }
      }
    },
    reset() {
      memory.reset()
      fallbackLogged = false
    },
  }
}
