import { beforeEach, describe, expect, it, vi } from 'vitest'
import { quoteTool } from '@/lib/tools/quote'
import { smartTriageTool } from '@/lib/tools/smart-triage'
import { inventoryTool } from '@/lib/tools/inventory'
import { createMemoryStore } from '@/lib/store/memory'
import { getAdminToken, getAdminConfig, resetAdminTokenCacheForTests } from '@/lib/shopify-admin'
import { ADMIN_ENV, BASE_ENV, adminCostResponse, mockFetch, product, shopifyResponse } from './helpers'

const HANDLE = 'iphone-13-battery'
const listing = () => shopifyResponse([product('iPhone 13 Battery', '89.00')]) // listed price $89
const input = { device_model: 'iPhone 13', repair_type: 'battery' }
let store: ReturnType<typeof createMemoryStore>

beforeEach(() => {
  store = createMemoryStore()
  resetAdminTokenCacheForTests()
})

const calls = (f: ReturnType<typeof mockFetch>) => f.mock.calls.map((c) => String(c[0]))

describe('wholesale cost via Admin API', () => {
  it('metafield present: uses it, marks cost confirmed', async () => {
    const fetchImpl = mockFetch({ shopify: listing, admin: () => adminCostResponse(HANDLE, '18') })
    const r = await quoteTool(input, { env: ADMIN_ENV, fetchImpl, store })
    expect(r.body).toMatchObject({ repair_price: 108, cost_confirmed: true }) // 18*1.8+75 = 107.4 -> 108
    expect(r.body).not.toHaveProperty('cost_status')
    const [, init] = fetchImpl.mock.calls.find((c) => String(c[0]).includes('/admin/api/')) as unknown as [string, RequestInit]
    const sent = JSON.parse(String(init.body)) as { query: string; variables: { query: string } }
    expect(sent.query.trim().startsWith('query')).toBe(true)
    expect(sent.query).not.toMatch(/mutation/i)
    expect(sent.variables.query).toBe(`handle:${HANDLE}`)
    expect((init.headers as Record<string, string>)['X-Shopify-Access-Token']).toBe('admin-token')
    expect((await store.get(String(r.body.ticket_id)))?.quote).toMatchObject({ costSource: 'admin_metafield', costConfirmed: true })
  })

  it('Storefront request never asks for the cost metafield', async () => {
    const fetchImpl = mockFetch({ shopify: listing, admin: () => adminCostResponse(HANDLE, '18') })
    await quoteTool(input, { env: ADMIN_ENV, fetchImpl, store })
    const sf = fetchImpl.mock.calls.find((c) => String(c[0]).includes('/api/2025-07/graphql.json')) as unknown as [string, RequestInit]
    expect(String(sf[1].body)).not.toMatch(/part_cost|metafield/)
  })

  it.each([
    ['metafield missing', { admin: () => adminCostResponse(HANDLE, null) }, ADMIN_ENV],
    ['metafield not a number', { admin: () => adminCostResponse(HANDLE, 'abc') }, ADMIN_ENV],
    ['Admin app unset', {}, BASE_ENV],
    ['Admin HTTP error', { admin: () => new Response('x', { status: 500 }) }, ADMIN_ENV],
    ['Admin GraphQL error', { admin: () => new Response(JSON.stringify({ errors: [{ message: 'denied' }] }), { status: 200 }) }, ADMIN_ENV],
    ['token request fails', { adminToken: () => new Response('{}', { status: 400 }) }, ADMIN_ENV],
    ['Admin network error', { admin: () => { throw new Error('ECONNRESET') } }, ADMIN_ENV],
  ])('%s: falls back to listed price, marked cost unconfirmed', async (_name, handlers, env) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const fetchImpl = mockFetch({ shopify: listing, ...handlers })
    const r = await quoteTool(input, { env, fetchImpl, store })
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ quote_available: true, repair_price: 236, cost_confirmed: false, cost_status: 'cost_unconfirmed' }) // 89*1.8+75 = 235.2 -> 236
    expect(String(r.body.message)).toMatch(/not yet confirmed/)
    if (env === BASE_ENV) expect(calls(fetchImpl).some((u) => u.includes('/admin/'))).toBe(false)
    warn.mockRestore()
  })

  it('caches the Admin token and refreshes once on 401', async () => {
    let adminCalls = 0
    const fetchImpl = mockFetch({
      shopify: listing,
      admin: () => (++adminCalls === 2 ? new Response('', { status: 401 }) : adminCostResponse(HANDLE, '18')),
    })
    await quoteTool(input, { env: ADMIN_ENV, fetchImpl, store })
    await quoteTool(input, { env: ADMIN_ENV, fetchImpl, store }) // 401 -> new token -> retry
    const tokenCalls = calls(fetchImpl).filter((u) => u.includes('/admin/oauth/access_token')).length
    expect(tokenCalls).toBe(2)
    await quoteTool(input, { env: ADMIN_ENV, fetchImpl, store })
    expect(calls(fetchImpl).filter((u) => u.includes('/admin/oauth/access_token')).length).toBe(2)
  })

  it('refreshes the token before it expires', async () => {
    const config = getAdminConfig(ADMIN_ENV)!
    let t = 0
    const fetchImpl = mockFetch({})
    await getAdminToken(config, { fetchImpl, now: () => t })
    t = 86399_000 - 6 * 60_000 // just before the 5-minute margin
    await getAdminToken(config, { fetchImpl, now: () => t })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    t = 86399_000 - 4 * 60_000
    await getAdminToken(config, { fetchImpl, now: () => t })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })
})

describe('cost never leaks', () => {
  const COST = '17.4321' // distinctive value
  it('is absent from quote responses, stored tickets, inventory, smart triage and logs', async () => {
    const logs: string[] = []
    const capture = (...a: unknown[]) => logs.push(a.map(String).join(' '))
    const spies = (['log', 'warn', 'error', 'info'] as const).map((m) => vi.spyOn(console, m).mockImplementation(capture))
    const fetchImpl = mockFetch({ shopify: listing, admin: () => adminCostResponse(HANDLE, COST) })

    const q = await quoteTool(input, { env: ADMIN_ENV, fetchImpl, store })
    const inv = await inventoryTool({ device_model: 'iPhone 13', part: 'battery' }, { env: ADMIN_ENV, fetchImpl })
    const st = smartTriageTool({ device_model: 'iPhone 13', symptoms: 'battery drains fast' })
    const ticket = await store.get(String(q.body.ticket_id))
    // Also trigger the error log path.
    await quoteTool(input, { env: ADMIN_ENV, fetchImpl: mockFetch({ shopify: listing, admin: () => new Response('x', { status: 503 }) }), store })

    const blob = JSON.stringify([q.body, inv.body, st.body, ticket, logs])
    expect(blob).not.toContain('17.43')
    expect(blob).not.toMatch(/part_?cost/i)
    expect(blob).not.toContain('admin-secret')
    expect(blob).not.toContain('admin-token')
    spies.forEach((s) => s.mockRestore())
  })

  it('client bundle modules do not import the Admin client', async () => {
    const fs = await import('node:fs')
    for (const f of ['components/SmartTriage.tsx', 'components/GuidedTriage.tsx', 'app/page.tsx', 'lib/tiers.ts', 'lib/config.ts']) {
      expect(fs.readFileSync(f, 'utf8')).not.toMatch(/shopify-admin|lib\/shopify/)
    }
  })
})
