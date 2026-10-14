import { vi } from 'vitest'

export const SECRET = 'test-secret-value-123'

export const BASE_ENV = {
  NODE_ENV: 'test',
  ELEVENLABS_WEBHOOK_SECRET: SECRET,
  TWILIO_ACCOUNT_SID: 'ACtest',
  TWILIO_AUTH_TOKEN: 'tok',
  TWILIO_FROM_NUMBER: '+15095550100',
  SLACK_ESCALATION_WEBHOOK_URL: 'https://hooks.slack.test/abc',
  SHOPIFY_STORE_DOMAIN: 'dcp-test.myshopify.com',
  SHOPIFY_CLIENT_ID: 'admin-client',
  SHOPIFY_CLIENT_SECRET: 'admin-secret',
}

/** Admin GraphQL response for the parts query. */
export function shopifyResponse(nodes: unknown[]) {
  return new Response(JSON.stringify({ data: { shop: { currencyCode: 'USD' }, products: { nodes } } }), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

export function product(title: string, price: string, extra: Record<string, unknown> = {}, variant: Record<string, unknown> = {}) {
  return {
    title,
    handle: title.toLowerCase().replace(/\W+/g, '-'),
    status: 'ACTIVE',
    publishedAt: '2026-01-01T00:00:00Z',
    partCost: null,
    variants: { nodes: [{ price, availableForSale: true, inventoryPolicy: 'DENY', ...variant }] },
    ...extra,
  }
}

/** Routes fetch calls by host so one mock can serve Shopify, Twilio and Slack. */
export const ADMIN_ENV = BASE_ENV
export const NO_SHOPIFY_ENV = { ...BASE_ENV, SHOPIFY_CLIENT_SECRET: '' }

export function mockFetch(handlers: {
  shopify?: () => Response
  twilio?: () => Response
  slack?: () => Response
  adminToken?: () => Response
  admin?: () => Response
}) {
  return vi.fn(async (url: string | URL | Request) => {
    const u = String(url)
    if (u.includes('/admin/oauth/access_token'))
      return handlers.adminToken?.() ?? new Response(JSON.stringify({ access_token: 'admin-token', expires_in: 86399 }), { status: 200 })
    if (u.includes('/admin/api/')) return handlers.admin?.() ?? handlers.shopify?.() ?? shopifyResponse([])
    if (u.includes('api.twilio.com')) return handlers.twilio?.() ?? new Response('{}', { status: 201 })
    if (u.includes('hooks.slack')) return handlers.slack?.() ?? new Response('ok', { status: 200 })
    throw new Error(`unexpected fetch ${u}`)
  })
}
