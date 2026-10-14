import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { secretsMatch, checkAgentRequest } from '@/lib/auth'
import { setTicketStoreForTests, getTicketStore } from '@/lib/store'
import { createMemoryStore } from '@/lib/store/memory'
import { POST as quotePOST, GET as quoteGET } from '@/app/api/pricing/quote/route'
import { POST as dispatchPOST } from '@/app/api/intake/dispatch-sms/route'
import { POST as escalatePOST } from '@/app/api/intake/escalate-tier3/route'
import { POST as classifyPOST } from '@/app/api/tools/classify/route'
import { POST as inventoryPOST } from '@/app/api/tools/check-part-inventory/route'
import { POST as compliancePOST } from '@/app/api/tools/validate-wa-r2r-compliance/route'
import { POST as telemetryPOST } from '@/app/api/tools/diagnose-telemetry/route'
import { GET as ticketsGET } from '@/app/api/tickets/route'
import { GET as ticketGET } from '@/app/api/tickets/[id]/route'
import { POST as smartPOST } from '@/app/api/smart-triage/route'
import { SECRET } from './helpers'

const post = (path: string, body: unknown, secret?: string) =>
  new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(secret !== undefined ? { 'X-DCP-Agent-Secret': secret } : {}) },
    body: JSON.stringify(body),
  })

const PROTECTED_POST: [string, (r: Request) => Promise<Response>][] = [
  ['/api/pricing/quote', quotePOST],
  ['/api/intake/dispatch-sms', dispatchPOST],
  ['/api/intake/escalate-tier3', escalatePOST],
  ['/api/tools/classify', classifyPOST],
  ['/api/tools/check-part-inventory', inventoryPOST],
  ['/api/tools/validate-wa-r2r-compliance', compliancePOST],
  ['/api/tools/diagnose-telemetry', telemetryPOST],
]

describe('secretsMatch', () => {
  it('compares correctly, including different lengths', () => {
    expect(secretsMatch('abc', 'abc')).toBe(true)
    expect(secretsMatch('abc', 'abd')).toBe(false)
    expect(secretsMatch('a', 'abcdefgh')).toBe(false)
  })

  it('fails closed with 503 when the secret env var is unset, in any environment', () => {
    for (const NODE_ENV of ['production', 'development', 'test']) {
      expect(checkAgentRequest({ method: 'POST', headers: new Headers({ 'x-dcp-agent-secret': 'x' }) }, { env: { NODE_ENV } })).toEqual({ status: 503, error: 'Tool endpoint is not configured' })
    }
  })
})

describe('route auth', () => {
  beforeEach(() => {
    vi.stubEnv('ELEVENLABS_WEBHOOK_SECRET', SECRET)
    setTicketStoreForTests(createMemoryStore())
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    setTicketStoreForTests(null)
  })

  it.each(PROTECTED_POST)('%s: 401 without or with a wrong secret', async (path, handler) => {
    expect((await handler(post(path, {}))).status).toBe(401)
    expect((await handler(post(path, {}, 'wrong'))).status).toBe(401)
  })

  it.each(PROTECTED_POST)('%s: 503 when ELEVENLABS_WEBHOOK_SECRET is unset', async (path, handler) => {
    vi.stubEnv('ELEVENLABS_WEBHOOK_SECRET', '')
    expect((await handler(post(path, {}, SECRET))).status).toBe(503)
  })

  it.each(PROTECTED_POST)('%s: passes auth with the right secret (400 on empty body)', async (path, handler) => {
    const res = await handler(post(path, {}, SECRET))
    expect(res.status).toBe(400)
  })

  it('405 for GET on POST-only tools', async () => {
    const res = quoteGET()
    expect(res.status).toBe(405)
    expect(res.headers.get('Allow')).toBe('POST')
  })

  it('400 on malformed JSON, 413 on oversized bodies', async () => {
    const bad = new Request('http://localhost/api/tools/classify', { method: 'POST', headers: { 'X-DCP-Agent-Secret': SECRET }, body: '{nope' })
    expect((await classifyPOST(bad)).status).toBe(400)
    expect((await classifyPOST(post('/api/tools/classify', { symptoms: 'x'.repeat(20_000) }, SECRET))).status).toBe(413)
  })

  it('end to end over HTTP: Tier 3 quote is refused, escalation persists, ticket readable with auth only', async () => {
    const q = await quotePOST(post('/api/pricing/quote', { device_model: 'iPhone 12', repair_type: 'logic_board' }, SECRET))
    expect(await q.json()).toMatchObject({ requires_escalation: true, quote_available: false })

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok', { status: 200 }))
    vi.stubEnv('SLACK_ESCALATION_WEBHOOK_URL', 'https://hooks.slack.test/x')
    const e = await escalatePOST(post('/api/intake/escalate-tier3', { customer_name: 'A', customer_phone: '5095550111', device_model: 'iPhone 12', failure_symptoms: 'no power' }, SECRET))
    const eb = await e.json()
    expect(e.status).toBe(200)
    fetchSpy.mockRestore()

    const get = (secret?: string) => new Request(`http://localhost/api/tickets/${eb.ticket_id}`, { headers: secret ? { 'X-DCP-Agent-Secret': secret } : {} })
    const params = { params: Promise.resolve({ id: eb.ticket_id as string }) }
    expect((await ticketGET(get(), params)).status).toBe(401)
    const ok = await ticketGET(get(SECRET), params)
    expect((await ok.json()).ticket).toMatchObject({ tier: 'TIER_3', status: 'escalated' })

    const list = await ticketsGET(new Request('http://localhost/api/tickets', { headers: { 'X-DCP-Agent-Secret': SECRET } }))
    expect((await list.json()).tickets).toHaveLength(1)
  })

  it('smart triage is public and does not need the secret', async () => {
    const res = await smartPOST(post('/api/smart-triage', { symptoms: 'battery dies fast' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ tier: 'Tier 1' })
  })
})

describe('ticket store selection', () => {
  it('never falls back to memory on Vercel without Upstash configured', () => {
    expect(getTicketStore({ NODE_ENV: 'production', VERCEL_ENV: 'production' })).toBeNull()
    expect(getTicketStore({ NODE_ENV: 'production', VERCEL_ENV: 'preview' })).toBeNull()
    expect(getTicketStore({ NODE_ENV: 'production' })).toBeNull()
  })
  it('uses Upstash when configured, memory only in dev/test', () => {
    expect(getTicketStore({ NODE_ENV: 'production', KV_REST_API_URL: 'https://x.upstash.io', KV_REST_API_TOKEN: 't' })?.kind).toBe('upstash-redis')
    expect(getTicketStore({ NODE_ENV: 'test' })?.kind).toBe('memory')
  })
})
