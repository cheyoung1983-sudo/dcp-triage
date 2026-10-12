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
  SHOPIFY_STOREFRONT_READONLY_TOKEN: 'sf-readonly',
}

export function shopifyResponse(nodes: unknown[]) {
  return new Response(JSON.stringify({ data: { products: { nodes } } }), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

export function product(title: string, price: string, extra: Record<string, unknown> = {}) {
  return {
    title,
    handle: title.toLowerCase().replace(/\W+/g, '-'),
    availableForSale: true,
    partCost: null,
    variants: { nodes: [{ price: { amount: price, currencyCode: 'USD' }, availableForSale: true }] },
    ...extra,
  }
}

/** Routes fetch calls by host so one mock can serve Shopify, Twilio and Slack. */
export function mockFetch(handlers: { shopify?: () => Response; twilio?: () => Response; slack?: () => Response }) {
  return vi.fn(async (url: string | URL | Request) => {
    const u = String(url)
    if (u.includes('myshopify.com')) return handlers.shopify?.() ?? shopifyResponse([])
    if (u.includes('api.twilio.com')) return handlers.twilio?.() ?? new Response('{}', { status: 201 })
    if (u.includes('hooks.slack')) return handlers.slack?.() ?? new Response('ok', { status: 200 })
    throw new Error(`unexpected fetch ${u}`)
  })
}
