import { beforeEach, describe, expect, it } from 'vitest'
import { quoteTool } from '@/lib/tools/quote'
import { dispatchTool, resetSmsLimiters, buildSmsBody, SMS_LIMITS } from '@/lib/tools/dispatch'
import { escalateTool, buildTier3SlackPayload } from '@/lib/tools/escalate'
import { classifyTool } from '@/lib/tools/classify'
import { inventoryTool } from '@/lib/tools/inventory'
import { telemetryTool } from '@/lib/tools/telemetry'
import { smartTriageTool } from '@/lib/tools/smart-triage'
import { createMemoryStore } from '@/lib/store/memory'
import { BASE_ENV, mockFetch, product, shopifyResponse } from './helpers'

let store: ReturnType<typeof createMemoryStore>

beforeEach(() => {
  store = createMemoryStore()
  resetSmsLimiters()
})

describe('quote', () => {
  it('prices Tier 2 from the Shopify part price with V4 and saves a ticket', async () => {
    const fetchImpl = mockFetch({ shopify: () => shopifyResponse([product('iPhone 13 Screen Replacement', '35.00')]) })
    const r = await quoteTool({ device_model: 'iPhone 13', repair_type: 'screen_aftermarket', mobile_service: true }, { env: BASE_ENV, fetchImpl, store })
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ quote_available: true, tier: 'Tier 2', repair_price: 138, mobile_trip_fee: 25, total: 163, tax_included: false })
    const t = await store.get(r.body.ticket_id as string)
    expect(t).toMatchObject({ status: 'quoted', tier: 'TIER_2', quote: { total: 163, partCostSource: 'variant_price' } })
  })

  it('prefers the dcp.part_cost metafield when Shopify exposes it', async () => {
    const fetchImpl = mockFetch({ shopify: () => shopifyResponse([product('iPhone 13 Battery', '89.00', { partCost: { value: '18' } })]) })
    const r = await quoteTool({ device_model: 'iPhone 13', repair_type: 'battery' }, { env: BASE_ENV, fetchImpl, store })
    expect(r.body).toMatchObject({ tier: 'Tier 1', repair_price: 108, total: 108, mobile_trip_fee: 0 }) // 32.4 + 75 = 107.4 -> 108
  })

  it('only sends a read query to Shopify (no mutations)', async () => {
    const fetchImpl = mockFetch({ shopify: () => shopifyResponse([product('Pixel 8 Screen', '60')]) })
    await quoteTool({ device_model: 'Pixel 8', repair_type: 'screen_oem' }, { env: BASE_ENV, fetchImpl, store })
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    const sent = JSON.parse(String(init.body)) as { query: string }
    expect(sent.query.trim().startsWith('query')).toBe(true)
    expect(sent.query).not.toMatch(/mutation/i)
    expect((init.headers as Record<string, string>)['X-Shopify-Storefront-Access-Token']).toBe('sf-readonly')
  })

  it('says the price needs confirmation when the Shopify token is unset', async () => {
    const env = { ...BASE_ENV, SHOPIFY_STOREFRONT_READONLY_TOKEN: '' }
    const r = await quoteTool({ device_model: 'iPhone 13', repair_type: 'battery' }, { env, fetchImpl: mockFetch({}), store })
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ quote_available: false, price_needs_confirmation: true })
    expect(r.body).not.toHaveProperty('total')
  })

  it('says the price needs confirmation when Shopify errors or has no match', async () => {
    const down = mockFetch({ shopify: () => new Response('nope', { status: 500 }) })
    expect((await quoteTool({ device_model: 'X', repair_type: 'camera' }, { env: BASE_ENV, fetchImpl: down, store })).body).toMatchObject({ price_needs_confirmation: true })
    const empty = mockFetch({ shopify: () => shopifyResponse([]) })
    expect((await quoteTool({ device_model: 'X', repair_type: 'camera' }, { env: BASE_ENV, fetchImpl: empty, store })).body).toMatchObject({ price_needs_confirmation: true })
  })

  it.each(['logic_board', 'liquid_damage', 'no_power', 'data_recovery', 'water_damage'])('refuses Tier 3 (%s) and points to escalation', async (repair_type) => {
    const fetchImpl = mockFetch({})
    const r = await quoteTool({ device_model: 'iPhone 14', repair_type }, { env: BASE_ENV, fetchImpl, store })
    expect(r.body).toMatchObject({ success: false, quote_available: false, tier: 'Tier 3', requires_escalation: true, escalation_tool: 'escalate_tier3_ticket' })
    expect(r.body).not.toHaveProperty('total')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('returns 503 instead of using memory when no store is available', async () => {
    const r = await quoteTool({ device_model: 'iPhone 13', repair_type: 'battery' }, { env: BASE_ENV, fetchImpl: mockFetch({}), store: null })
    expect(r.status).toBe(503)
  })

  it('400s on bad input', async () => {
    expect((await quoteTool({ repair_type: 'battery' }, { env: BASE_ENV, store })).status).toBe(400)
    expect((await quoteTool({ device_model: 'x', repair_type: 'teleport' }, { env: BASE_ENV, store })).status).toBe(400)
  })
})

describe('dispatch SMS (mocked Twilio)', () => {
  async function quoted(mobile = false) {
    const fetchImpl = mockFetch({ shopify: () => shopifyResponse([product('iPhone 13 Screen', '35')]) })
    const r = await quoteTool({ device_model: 'iPhone 13', repair_type: 'screen_aftermarket', mobile_service: mobile }, { env: BASE_ENV, fetchImpl, store })
    return r.body.ticket_id as string
  }

  it('texts the stored price with the FAQ link and business phone, and updates the ticket', async () => {
    const ticket_id = await quoted(true)
    const fetchImpl = mockFetch({})
    const r = await dispatchTool({ ticket_id, customer_name: 'Pat', customer_phone: '(509) 555-0123' }, { env: BASE_ENV, fetchImpl, store, clientIp: '1.1.1.1' })
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ smsSent: true, ticket_id })
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toContain('api.twilio.com/2010-04-01/Accounts/ACtest/Messages.json')
    const params = new URLSearchParams(String(init.body))
    expect(params.get('To')).toBe('+15095550123')
    expect(params.get('Body')).toContain('$163 (includes $25 mobile trip fee)')
    expect(params.get('Body')).toContain('https://www.displaycellpros.com/services-faq')
    expect(params.get('Body')).toContain('(509) 255-3852')
    const t = await store.get(ticket_id)
    expect(t?.status).toBe('link_sent')
    expect(t?.customer?.phone).toBe('+15095550123')
    expect(t?.events.map((e) => e.type)).toContain('sms_sent')
  })

  it('never uses a price supplied by the agent', async () => {
    const ticket_id = await quoted()
    const fetchImpl = mockFetch({})
    await dispatchTool({ ticket_id, customer_name: 'Pat', customer_phone: '5095550123', quoted_price: 1 }, { env: BASE_ENV, fetchImpl, store })
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(new URLSearchParams(String(init.body)).get('Body')).toContain('$138')
  })

  it('refuses Tier 3 tickets and tickets without a confirmed price', async () => {
    const esc = await escalateTool(
      { customer_name: 'Sam', customer_phone: '5095550199', device_model: 'iPhone 12', failure_symptoms: 'no power' },
      { env: BASE_ENV, fetchImpl: mockFetch({}), store }
    )
    const r = await dispatchTool({ ticket_id: esc.body.ticket_id, customer_name: 'Sam', customer_phone: '5095550199' }, { env: BASE_ENV, fetchImpl: mockFetch({}), store })
    expect(r.status).toBe(409)

    const unpriced = await quoteTool({ device_model: 'iPhone 13', repair_type: 'battery' }, { env: { ...BASE_ENV, SHOPIFY_STOREFRONT_READONLY_TOKEN: '' }, store })
    const r2 = await dispatchTool({ ticket_id: unpriced.body.ticket_id, customer_name: 'Sam', customer_phone: '5095550199' }, { env: BASE_ENV, fetchImpl: mockFetch({}), store })
    expect(r2.status).toBe(409)
  })

  it('404s for unknown tickets and 400s for bad phones', async () => {
    expect((await dispatchTool({ ticket_id: 'DCP-T1-NOPE', customer_name: 'A', customer_phone: '5095550123' }, { env: BASE_ENV, store })).status).toBe(404)
    expect((await dispatchTool({ ticket_id: 'x', customer_name: 'A', customer_phone: '555-1234' }, { env: BASE_ENV, store })).status).toBe(400)
  })

  it('503s when Twilio is not configured and does not claim a send', async () => {
    const ticket_id = await quoted()
    const r = await dispatchTool({ ticket_id, customer_name: 'A', customer_phone: '5095550123' }, { env: { ...BASE_ENV, TWILIO_AUTH_TOKEN: '' }, store })
    expect(r.status).toBe(503)
    expect(r.body.smsSent).toBe(false)
  })

  it('502s and records the failure when Twilio rejects', async () => {
    const ticket_id = await quoted()
    const r = await dispatchTool({ ticket_id, customer_name: 'A', customer_phone: '5095550123' }, { env: BASE_ENV, fetchImpl: mockFetch({ twilio: () => new Response('bad', { status: 400 }) }), store })
    expect(r.status).toBe(502)
    expect((await store.get(ticket_id))?.events.map((e) => e.type)).toContain('sms_failed')
  })

  it('rate-limits texts per phone number', async () => {
    const ticket_id = await quoted()
    const fetchImpl = mockFetch({})
    for (let i = 0; i < SMS_LIMITS.perPhonePerHour; i++) {
      expect((await dispatchTool({ ticket_id, customer_name: 'A', customer_phone: '5095550123' }, { env: BASE_ENV, fetchImpl, store, clientIp: `10.0.0.${i}` })).status).toBe(200)
    }
    const r = await dispatchTool({ ticket_id, customer_name: 'A', customer_phone: '5095550123' }, { env: BASE_ENV, fetchImpl, store, clientIp: '10.0.1.1' })
    expect(r.status).toBe(429)
    expect(r.headers?.['Retry-After']).toBeDefined()
  })

  it('sanitizes nothing user-controlled into the SMS beyond the ticket ref', () => {
    expect(buildSmsBody({ tierLabel: 'Tier 1', total: 108, tripFee: 0, ticketId: 'DCP-T1-X' })).toBe(
      'Display & Cell Pros: Your Tier 1 repair estimate is $108, before tax. Ref DCP-T1-X. Details and next steps: https://www.displaycellpros.com/services-faq Questions? Call (509) 255-3852. Reply STOP to opt out.'
    )
  })
})

describe('Tier 3 escalation (mocked Slack)', () => {
  const input = {
    customer_name: 'Jo <!channel>',
    customer_phone: '(509) 555-0142',
    customer_email: 'jo@example.com',
    device_model: 'iPhone 15 Pro',
    failure_symptoms: 'Dropped in a lake, no power. Call me at 509-555-0142 or jo@example.com',
    intake_notes: 'prefers mornings',
  }

  it('saves the ticket with contact info and posts to Slack without phone or email', async () => {
    const fetchImpl = mockFetch({})
    const r = await escalateTool(input, { env: BASE_ENV, fetchImpl, store })
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ escalated: true })
    expect(r.body).not.toHaveProperty('total')
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(BASE_ENV.SLACK_ESCALATION_WEBHOOK_URL)
    const text = JSON.parse(String(init.body)).text as string
    expect(text).toContain(String(r.body.ticket_id))
    expect(text).not.toMatch(/555[-\s]?0142/)
    expect(text).not.toContain('jo@example.com')
    expect(text).not.toContain('<!channel>')
    expect(text).toContain('&lt;!channel&gt;')
    const t = await store.get(String(r.body.ticket_id))
    expect(t).toMatchObject({ tier: 'TIER_3', status: 'escalated', customer: { phone: '+15095550142', email: 'jo@example.com' } })
    expect(t?.events.map((e) => e.type)).toEqual(['created', 'escalated'])
  })

  it('reclassifies an existing quoted ticket to Tier 3 and voids its estimate', async () => {
    const q = await quoteTool({ device_model: 'iPhone 13', repair_type: 'battery' }, { env: BASE_ENV, fetchImpl: mockFetch({ shopify: () => shopifyResponse([product('iPhone 13 Battery', '18')]) }), store })
    const r = await escalateTool({ ...input, ticket_id: q.body.ticket_id }, { env: BASE_ENV, fetchImpl: mockFetch({}), store })
    expect(r.body.ticket_id).toBe(q.body.ticket_id)
    const t = await store.get(String(q.body.ticket_id))
    expect(t?.tier).toBe('TIER_3')
    expect(t?.quote).toBeUndefined()
  })

  it('503s when Slack is not configured', async () => {
    const r = await escalateTool(input, { env: { ...BASE_ENV, SLACK_ESCALATION_WEBHOOK_URL: '' }, store })
    expect(r.status).toBe(503)
  })

  it('502s but keeps the ticket when Slack fails', async () => {
    const r = await escalateTool(input, { env: BASE_ENV, fetchImpl: mockFetch({ slack: () => new Response('x', { status: 500 }) }), store })
    expect(r.status).toBe(502)
    expect((await store.get(String(r.body.ticket_id)))?.events.map((e) => e.type)).toContain('escalation_failed')
  })

  it('payload builder redacts contact info', () => {
    const p = buildTier3SlackPayload({ ticketId: 'T', customerName: 'A', deviceModel: 'B', failureSymptoms: 'call +1 509 555 0100', intakeNotes: '' })
    expect(p.text).toContain('[phone redacted]')
  })
})

describe('other tools', () => {
  it('classify tool routes liquid damage to escalation', () => {
    expect(classifyTool({ symptoms: 'spilled coffee on it' }).body).toMatchObject({ tier: 'Tier 3', requires_escalation: true })
  })

  it('inventory reports availability without inventing quantities', async () => {
    const r = await inventoryTool({ device_model: 'iPhone 13', part: 'battery' }, { env: BASE_ENV, fetchImpl: mockFetch({ shopify: () => shopifyResponse([product('iPhone 13 Battery', '18')]) }) })
    expect(r.body).toMatchObject({ inventory_known: true, any_available: true })
    expect(JSON.stringify(r.body)).not.toMatch(/quantity|bin/i)
    const off = await inventoryTool({ device_model: 'iPhone 13', part: 'battery' }, { env: { ...BASE_ENV, SHOPIFY_STOREFRONT_READONLY_TOKEN: '' } })
    expect(off.body).toMatchObject({ inventory_known: false })
  })

  it('telemetry flags thermal lockout, escalates, and alerts the ops number', async () => {
    const fetchImpl = mockFetch({})
    const r = await telemetryTool({ device_id: 'bench-1', v_term: 5, current_draw: 6, thermal_reading: 47 }, { env: { ...BASE_ENV, THERMAL_LOCKOUT_ALERT_PHONE: '5095550100' }, fetchImpl })
    expect(r.body).toMatchObject({ thermal_lockout: true, alert_sent: true, recommended_tier: 'Tier 3', requires_escalation: true })
  })

  it('smart triage (public) gives tier and guidance without collecting contact info', () => {
    const r = smartTriageTool({ device_model: 'iPhone 13', symptoms: 'screen cracked, touch not working' })
    expect(r.body).toMatchObject({ tier: 'Tier 2', requires_escalation: false })
    expect(String(r.body.next_step)).toContain('(509) 255-3852')
  })
})
