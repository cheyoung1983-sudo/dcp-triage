import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSharedLimiter } from '@/lib/shared-limit'
import { getClientIp } from '@/lib/auth'
import { readJson } from '@/lib/http'
import { pageCsp, API_CSP } from '@/lib/csp'
import { smartTriageTool } from '@/lib/tools/smart-triage'
import { modelScore } from '@/lib/diagnostics/knowledge-base'
import { POST as smartPOST, limiter as smartLimiter } from '@/app/api/smart-triage/route'

const KV = { KV_REST_API_URL: 'https://kv.upstash.test', KV_REST_API_TOKEN: 'tok' }

/** Fake Upstash pipeline endpoint holding counters in a Map. */
function fakeRedis() {
  const counts = new Map<string, number>()
  const ttls = new Map<string, number>()
  const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const cmds = JSON.parse(String(init?.body)) as (string | number)[][]
    const out = cmds.map(([cmd, key, arg]) => {
      const k = String(key)
      if (cmd === 'INCR') { const n = (counts.get(k) ?? 0) + 1; counts.set(k, n); return { result: n } }
      if (cmd === 'EXPIRE') { if (!ttls.has(k)) ttls.set(k, Number(arg)); return { result: 1 } }
      if (cmd === 'TTL') return { result: ttls.get(k) ?? -1 }
      return { error: 'unknown' }
    })
    return new Response(JSON.stringify(out), { status: 200 })
  })
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls: fetchImpl }
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs() })

describe('shared rate limiter', () => {
  it('shares counts across limiter instances (simulated serverless instances)', async () => {
    const redis = fakeRedis()
    const a = createSharedLimiter({ name: 't', limit: 3, windowSeconds: 60, failOpen: true, env: KV, fetchImpl: redis.fetchImpl })
    const b = createSharedLimiter({ name: 't', limit: 3, windowSeconds: 60, failOpen: true, env: KV, fetchImpl: redis.fetchImpl })
    expect((await a.consume('k')).allowed).toBe(true)
    expect((await b.consume('k')).allowed).toBe(true)
    expect((await a.consume('k')).allowed).toBe(true)
    const blocked = await b.consume('k')
    expect(blocked).toMatchObject({ allowed: false, source: 'redis' })
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0)
    const auth = (redis.calls.mock.calls[0][1] as RequestInit).headers as Record<string, string>
    expect(auth.Authorization).toBe('Bearer tok')
  })

  it('falls back to memory and logs when KV env is missing', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const l = createSharedLimiter({ name: 'nokv', limit: 1, windowSeconds: 60, failOpen: true, env: {} })
    l.reset()
    expect(await l.consume('k')).toMatchObject({ allowed: true, source: 'memory' })
    expect((await l.consume('k')).allowed).toBe(false)
    expect(err).toHaveBeenCalled()
  })

  it('fails open with a warning for smart-triage when Redis errors', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const broken = (async () => new Response('down', { status: 500 })) as unknown as typeof fetch
    const l = createSharedLimiter({ name: 'down', limit: 1, windowSeconds: 60, failOpen: true, env: KV, fetchImpl: broken })
    expect(await l.consume('k')).toMatchObject({ allowed: true, source: 'open' })
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('fail-open'))
  })

  it('fails closed with an error for SMS when Redis errors or returns an error item', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const cmdErr = (async () => new Response(JSON.stringify([{ error: 'ERR syntax' }, { result: 1 }, { result: 60 }]), { status: 200 })) as unknown as typeof fetch
    const l = createSharedLimiter({ name: 'sms', limit: 5, windowSeconds: 60, failOpen: false, env: KV, fetchImpl: cmdErr })
    const d = await l.consume('k')
    expect(d).toMatchObject({ allowed: false, source: 'closed' })
    expect(d.retryAfterSeconds).toBeGreaterThan(0)
    expect(err).toHaveBeenCalledWith(expect.stringContaining('fail-closed'))
  })

  it('keys one client consistently even when proxy hops vary (regression)', () => {
    const a = new Headers({ 'x-vercel-forwarded-for': '198.51.100.7', 'x-real-ip': '10.0.0.1', 'x-forwarded-for': '10.0.0.1, 198.51.100.7' })
    const b = new Headers({ 'x-vercel-forwarded-for': '198.51.100.7', 'x-real-ip': '10.0.0.2', 'x-forwarded-for': '10.0.0.2' })
    expect(getClientIp(a)).toBe('198.51.100.7')
    expect(getClientIp(b)).toBe('198.51.100.7')
  })

  it('smart-triage route enforces the shared Redis limit across instances (regression)', async () => {
    const redis = fakeRedis()
    vi.stubEnv('KV_REST_API_URL', KV.KV_REST_API_URL)
    vi.stubEnv('KV_REST_API_TOKEN', KV.KV_REST_API_TOKEN)
    vi.stubGlobal('fetch', redis.fetchImpl)
    const req = () => new Request('http://localhost/api/smart-triage', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-vercel-forwarded-for': '198.51.100.9' },
      body: JSON.stringify({ symptoms: 'battery dies fast' }),
    })
    for (let i = 0; i < 30; i++) {
      const r = await smartPOST(req())
      expect(r.status).toBe(200)
      expect(r.headers.get('X-RateLimit-Source')).toBe('redis')
    }
    const res = await smartPOST(req())
    expect(res.status).toBe(429)
    expect(Number(res.headers.get('Retry-After'))).toBeGreaterThan(0)
    vi.unstubAllGlobals()
  })

  it('smart-triage route returns 429 with Retry-After after 30 requests', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    smartLimiter.reset()
    const req = () => new Request('http://localhost/api/smart-triage', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '203.0.113.9' },
      body: JSON.stringify({ symptoms: 'battery dies fast' }),
    })
    for (let i = 0; i < 30; i++) expect((await smartPOST(req())).status).toBe(200)
    const res = await smartPOST(req())
    expect(res.status).toBe(429)
    expect(Number(res.headers.get('Retry-After'))).toBeGreaterThan(0)
    smartLimiter.reset()
  })
})

describe('body size limit (bytes)', () => {
  const big = (s: string) => new Request('http://localhost/x', { method: 'POST', body: s })
  it('rejects multi-byte bodies over 16 KB even when under 16K characters', async () => {
    const text = JSON.stringify({ s: 'é'.repeat(9000) }) // ~9k chars, ~18k bytes
    expect(text.length).toBeLessThan(16 * 1024)
    const r = await readJson(big(text))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.response.status).toBe(413)
  })
  it('rejects early on an oversized Content-Length', async () => {
    const req = new Request('http://localhost/x', { method: 'POST', body: '{}', headers: { 'content-length': '999999' } })
    const r = await readJson(req)
    expect(r.ok).toBe(false)
  })
  it('rejects a streamed body without Content-Length once it passes the limit', async () => {
    const chunk = new TextEncoder().encode('a'.repeat(4096))
    let sent = 0
    const stream = new ReadableStream<Uint8Array>({ pull(c) { if (sent++ < 10) c.enqueue(chunk); else c.close() } })
    const req = new Request('http://localhost/x', { method: 'POST', body: stream, duplex: 'half' } as RequestInit)
    const r = await readJson(req)
    expect(r.ok).toBe(false)
    expect(sent).toBeLessThan(10)
  })
  it('accepts normal JSON and multi-byte text under the limit', async () => {
    const r = await readJson(big(JSON.stringify({ s: 'pantalla rota ñ é' })))
    expect(r).toMatchObject({ ok: true, data: { s: 'pantalla rota ñ é' } })
  })
})

describe('content security policy', () => {
  it('page policy uses a nonce and no unsafe-inline scripts', () => {
    const p = pageCsp('abc')
    expect(p).toContain("script-src 'self' 'nonce-abc' 'strict-dynamic'")
    expect(p).not.toMatch(/script-src[^;]*unsafe-inline/)
    expect(p).toContain("frame-ancestors 'none'")
  })
  it('API policy denies everything', () => {
    expect(API_CSP).toContain("default-src 'none'")
  })
})

describe('smart triage model relevance', () => {
  it('scores the named model number above the same family', () => {
    expect(modelScore('iphone 13 screen', 'iPhone 13 Pro Max')).toBeGreaterThan(modelScore('iphone 13 screen', 'iPhone 15 Pro'))
    expect(modelScore('galaxy s24', 'Galaxy S24 Ultra / S24+')).toBe(8)
    expect(modelScore('', 'iPhone 15 Pro')).toBe(0)
  })
  it('prefers the named model over others', () => {
    const r = smartTriageTool({ symptoms: 'my iPhone 13 screen is cracked and touch does not work' })
    const body = r.body as { related_known_issues: { device: string }[] }
    expect(body.related_known_issues.length).toBeGreaterThan(0)
    expect(body.related_known_issues[0].device).toContain('iPhone 13')
  })
})
