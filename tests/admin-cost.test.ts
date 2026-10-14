import { beforeEach, describe, expect, it, vi } from 'vitest'
import { quoteTool } from '@/lib/tools/quote'
import { smartTriageTool } from '@/lib/tools/smart-triage'
import { inventoryTool } from '@/lib/tools/inventory'
import { dispatchTool, resetSmsLimiters } from '@/lib/tools/dispatch'
import { createMemoryStore } from '@/lib/store/memory'
import { adminQuery, getAdminToken, getAdminConfig, resetAdminTokenCacheForTests } from '@/lib/shopify-admin'
import { ADMIN_ENV, NO_SHOPIFY_ENV, mockFetch, product, shopifyResponse } from './helpers'

const input = { device_model: 'iPhone 13', repair_type: 'battery' }
const withCost = (value: string | null, variant: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => () =>
  shopifyResponse([product('iPhone 13 Battery', '89.00', { partCost: value === null ? null : { value }, ...extra }, variant)]) // listed $89
let store: ReturnType<typeof createMemoryStore>

beforeEach(() => {
  store = createMemoryStore()
  resetAdminTokenCacheForTests()
  resetSmsLimiters()
})

const urls = (f: ReturnType<typeof mockFetch>) => f.mock.calls.map((c) => String(c[0]))

describe('Admin API: one query for listing + cost', () => {
  it('metafield present: uses it, cost confirmed, single read-only Admin query', async () => {
    const fetchImpl = mockFetch({ admin: withCost('18') })
    const r = await quoteTool(input, { env: ADMIN_ENV, fetchImpl, store })
    expect(r.body).toMatchObject({ repair_price: 108, cost_confirmed: true, part_available: true, currency: 'USD' }) // 18*1.8+75 = 107.4 -> 108
    expect(r.body).not.toHaveProperty('cost_status')
    expect(urls(fetchImpl).filter((u) => u.includes('/admin/api/'))).toHaveLength(1)
    const [, init] = fetchImpl.mock.calls.find((c) => String(c[0]).includes('/admin/api/')) as unknown as [string, RequestInit]
    const q = JSON.parse(String(init.body)).query as string
    expect(q).toMatch(/metafield\(namespace: "dcp", key: "part_cost"\)/)
    expect(q).toMatch(/price/)
    expect(q).not.toMatch(/mutation|inventoryQuantity/i)
    expect((await store.get(String(r.body.ticket_id)))?.quote).toMatchObject({ costSource: 'admin_metafield', costConfirmed: true })
  })

  it.each([
    ['metafield missing', null],
    ['metafield not a number', 'abc'],
    ['metafield negative', '-5'],
  ])('%s: no number from the listed price; price needs confirmation, ticket recorded, availability kept', async (_n, value) => {
    const r = await quoteTool(input, { env: ADMIN_ENV, fetchImpl: mockFetch({ admin: withCost(value) }), store })
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({
      quote_available: false,
      price_needs_confirmation: true,
      cost_confirmed: false,
      cost_status: 'cost_unconfirmed',
      part_found: true,
      part_available: true,
    })
    for (const k of ['total', 'repair_price', 'mobile_trip_fee', 'lines']) expect(r.body).not.toHaveProperty(k)
    expect(String(r.body.message)).toMatch(/technician will confirm the price/)
    expect(JSON.stringify(r.body)).not.toMatch(/\$\d/)
    const t = await store.get(String(r.body.ticket_id))
    expect(t).toMatchObject({ status: 'quoted', tier: 'TIER_1' })
    expect(t?.quote).toBeUndefined()
  })

  it('Flow preview case: iPhone 13 OLED listed $165.18 without metafield yields no number (was $373 + $25)', async () => {
    const fetchImpl = mockFetch({ admin: () => shopifyResponse([product('iPhone 13 OLED Screen', '165.18')]) })
    const r = await quoteTool({ device_model: 'iPhone 13', repair_type: 'screen_aftermarket', mobile_service: true }, { env: ADMIN_ENV, fetchImpl, store })
    expect(r.body).toMatchObject({ quote_available: false, price_needs_confirmation: true, cost_status: 'cost_unconfirmed', part_available: true })
    expect(r.body).not.toHaveProperty('mobile_trip_fee')
    const text = JSON.stringify(r.body)
    for (const n of ['373', '398', '165.18']) expect(text).not.toContain(n)
    expect(text).not.toMatch(/\$\d/)

    // dispatch-sms must not text any price for it
    const sms = mockFetch({})
    const d = await dispatchTool({ ticket_id: r.body.ticket_id, customer_name: 'Pat', customer_phone: '5095550123' }, { env: ADMIN_ENV, fetchImpl: sms, store })
    expect(d.status).toBe(409)
    expect(d.body).toMatchObject({ smsSent: false })
    expect(sms).not.toHaveBeenCalled()
  })

  it.each([
    ['Admin app unset', NO_SHOPIFY_ENV, {}],
    ['Admin HTTP error', ADMIN_ENV, { admin: () => new Response('x', { status: 500 }) }],
    ['Admin GraphQL error', ADMIN_ENV, { admin: () => new Response(JSON.stringify({ errors: [{ message: 'denied' }] }), { status: 200 }) }],
    ['token request fails', ADMIN_ENV, { adminToken: () => new Response('{}', { status: 400 }) }],
    ['Admin network error', ADMIN_ENV, { admin: () => { throw new Error('ECONNRESET') } }],
  ])('%s: price needs confirmation, no number', async (_n, env, handlers) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const fetchImpl = mockFetch(handlers)
    const r = await quoteTool(input, { env, fetchImpl, store })
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ quote_available: false, price_needs_confirmation: true })
    expect(r.body).not.toHaveProperty('total')
    if (env === NO_SHOPIFY_ENV) expect(fetchImpl).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('availability: draft, unpublished, or sold out with DENY is unavailable; CONTINUE is available', async () => {
    const avail = async (variant: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
      (await inventoryTool({ device_model: 'iPhone 13', part: 'battery' }, { env: ADMIN_ENV, fetchImpl: mockFetch({ admin: withCost(null, variant, extra) }) })).body
    expect(await avail({})).toMatchObject({ any_available: true })
    expect(await avail({ availableForSale: false })).toMatchObject({ any_available: false })
    expect(await avail({ availableForSale: false, inventoryPolicy: 'CONTINUE' })).toMatchObject({ any_available: true })
    expect(await avail({}, { publishedAt: null })).toMatchObject({ any_available: false })
    expect(await avail({}, { status: 'DRAFT' })).toMatchObject({ any_available: false })
    const unset = await inventoryTool({ device_model: 'iPhone 13', part: 'battery' }, { env: NO_SHOPIFY_ENV, fetchImpl: mockFetch({}) })
    expect(unset.body).toMatchObject({ inventory_known: false })
  })

  it('refuses to send mutations', async () => {
    await expect(adminQuery('mutation { productDelete(input: {}) { deletedProductId } }', {}, { env: ADMIN_ENV, fetchImpl: mockFetch({}) })).rejects.toThrow(/not allowed/)
  })

  it('caches the Admin token and refreshes once on 401', async () => {
    let adminCalls = 0
    const fetchImpl = mockFetch({ admin: () => (++adminCalls === 2 ? new Response('', { status: 401 }) : withCost('18')()) })
    await quoteTool(input, { env: ADMIN_ENV, fetchImpl, store })
    const r2 = await quoteTool(input, { env: ADMIN_ENV, fetchImpl, store }) // 401 -> new token -> retry
    expect(r2.body).toMatchObject({ cost_confirmed: true })
    expect(urls(fetchImpl).filter((u) => u.includes('/admin/oauth/access_token'))).toHaveLength(2)
    await quoteTool(input, { env: ADMIN_ENV, fetchImpl, store })
    expect(urls(fetchImpl).filter((u) => u.includes('/admin/oauth/access_token'))).toHaveLength(2)
  })

  it('refreshes the token before it expires', async () => {
    const config = getAdminConfig(ADMIN_ENV)!
    let t = 0
    const fetchImpl = mockFetch({})
    await getAdminToken(config, { fetchImpl, now: () => t })
    t = 86399_000 - 6 * 60_000
    await getAdminToken(config, { fetchImpl, now: () => t })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    t = 86399_000 - 4 * 60_000
    await getAdminToken(config, { fetchImpl, now: () => t })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })
})

describe('cost never leaks', () => {
  const COST = '17.4321'
  it('is absent from quote and inventory responses, tickets, smart triage and logs', async () => {
    const logs: string[] = []
    const capture = (...a: unknown[]) => logs.push(a.map(String).join(' '))
    const spies = (['log', 'warn', 'error', 'info'] as const).map((m) => vi.spyOn(console, m).mockImplementation(capture))
    const fetchImpl = mockFetch({ admin: withCost(COST) })

    const q = await quoteTool(input, { env: ADMIN_ENV, fetchImpl, store })
    const inv = await inventoryTool({ device_model: 'iPhone 13', part: 'battery' }, { env: ADMIN_ENV, fetchImpl })
    const st = smartTriageTool({ device_model: 'iPhone 13', symptoms: 'battery drains fast' })
    const ticket = await store.get(String(q.body.ticket_id))
    await quoteTool(input, { env: ADMIN_ENV, fetchImpl: mockFetch({ admin: () => new Response('x', { status: 503 }) }), store })

    expect(q.body).toMatchObject({ cost_confirmed: true })
    const blob = JSON.stringify([q.body, inv.body, st.body, ticket, logs])
    expect(blob).not.toContain('17.43')
    expect(blob).not.toMatch(/part_?cost/i)
    expect(blob).not.toContain('admin-secret')
    expect(blob).not.toContain('admin-token')
    spies.forEach((s) => s.mockRestore())
  })

  it('client modules do not import Shopify code', async () => {
    const fs = await import('node:fs')
    for (const f of ['components/SmartTriage.tsx', 'components/GuidedTriage.tsx', 'app/page.tsx', 'lib/tiers.ts', 'lib/config.ts']) {
      expect(fs.readFileSync(f, 'utf8')).not.toMatch(/shopify/i)
    }
  })
})
