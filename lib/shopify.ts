/**
 * READ-ONLY Shopify lookups for parts.
 *
 * Storefront API (SHOPIFY_STOREFRONT_READONLY_TOKEN, treated as public-grade):
 * product search, availability and LISTED price only. Wholesale cost is
 * never requested through it.
 *
 * Wholesale cost (`dcp.part_cost` metafield) comes server-side from the
 * Admin API in ./shopify-admin. If the Admin app isn't configured, errors,
 * or the metafield is missing, the listed price is used and the quote is
 * marked cost unconfirmed.
 */
import { getPartCostByHandle } from './shopify-admin'

export const STOREFRONT_API_VERSION = '2025-07'

export interface ShopifyConfig {
  domain: string
  token: string
}

export interface PartListing {
  productTitle: string
  handle: string
  listedPrice: number
  currency: string
  availableForSale: boolean
}

export type CostSource = 'admin_metafield' | 'storefront_listed_price'

/** Server-only. `partCost` must never leave the server. */
export interface PartCost {
  handle: string
  currency: string
  availableForSale: boolean
  partCost: number
  costSource: CostSource
  costConfirmed: boolean
}

export function getShopifyConfig(env: Record<string, string | undefined> = process.env): ShopifyConfig | null {
  const domain = (env.SHOPIFY_STORE_DOMAIN || '').trim().replace(/^https?:\/\//, '').replace(/\/+$/, '')
  const token = (env.SHOPIFY_STOREFRONT_READONLY_TOKEN || '').trim()
  if (!domain || !token) return null
  if (!/^[a-z0-9.-]+$/i.test(domain)) return null
  return { domain, token }
}

const PRODUCTS_QUERY = `query DcpPartLookup($query: String!) {
  products(first: 5, query: $query) {
    nodes {
      title
      handle
      availableForSale
      variants(first: 1) { nodes { price { amount currencyCode } availableForSale } }
    }
  }
}`

interface ProductNode {
  title: string
  handle: string
  availableForSale: boolean
  variants: { nodes: { price: { amount: string; currencyCode: string }; availableForSale: boolean }[] }
}

/** Escapes a free-text term for Shopify's search syntax. */
export function buildSearchQuery(deviceModel: string, partKeyword: string): string {
  const clean = (s: string) => s.replace(/["\\:()]/g, ' ').replace(/\s+/g, ' ').trim()
  return [clean(deviceModel), clean(partKeyword)].filter(Boolean).map((t) => `"${t}"`).join(' AND ')
}

export async function searchPartProducts(
  deviceModel: string,
  partKeyword: string,
  ctx: { env?: Record<string, string | undefined>; fetchImpl?: typeof fetch } = {}
): Promise<PartListing[] | null> {
  const config = getShopifyConfig(ctx.env)
  if (!config) return null
  try {
    const res = await (ctx.fetchImpl ?? fetch)(`https://${config.domain}/api/${STOREFRONT_API_VERSION}/graphql.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Storefront-Access-Token': config.token,
      },
      body: JSON.stringify({ query: PRODUCTS_QUERY, variables: { query: buildSearchQuery(deviceModel, partKeyword) } }),
      signal: AbortSignal.timeout(8_000),
    })
    if (!res.ok) return null
    const json = (await res.json()) as { data?: { products?: { nodes?: ProductNode[] } } }
    const nodes = json.data?.products?.nodes ?? []
    const out: PartListing[] = []
    for (const node of nodes) {
      const variant = node.variants?.nodes?.[0]
      const amount = variant ? Number(variant.price.amount) : NaN
      if (!variant || !Number.isFinite(amount) || amount < 0) continue
      out.push({
        productTitle: node.title,
        handle: node.handle,
        listedPrice: amount,
        currency: variant.price.currencyCode,
        availableForSale: node.availableForSale && variant.availableForSale,
      })
    }
    return out
  } catch {
    return null
  }
}

export const PART_KEYWORDS: Record<string, string> = {
  battery: 'battery',
  charging_port: 'charging port',
  screen_aftermarket: 'screen',
  screen_oem: 'screen',
  camera: 'camera',
  back_glass: 'back glass',
}

/** Picks the best matching listing for a quotable repair, or null. */
export async function findPartListing(
  deviceModel: string,
  repairType: string,
  ctx: { env?: Record<string, string | undefined>; fetchImpl?: typeof fetch } = {}
): Promise<PartListing | null> {
  const keyword = PART_KEYWORDS[repairType]
  if (!keyword) return null
  const results = await searchPartProducts(deviceModel, keyword, ctx)
  if (!results?.length) return null
  if (repairType === 'screen_oem') {
    const oem = results.find((r) => /\b(oem|genuine|original|service pack)\b/i.test(r.productTitle))
    if (oem) return oem
  }
  if (repairType === 'screen_aftermarket') {
    const am = results.find((r) => !/\b(oem|genuine|original|service pack)\b/i.test(r.productTitle))
    if (am) return am
  }
  return results[0]
}

/**
 * Server-only: part cost for a quote. Admin metafield when available
 * (confirmed), otherwise the Storefront listed price (unconfirmed).
 */
export async function lookupPartCost(
  deviceModel: string,
  repairType: string,
  ctx: { env?: Record<string, string | undefined>; fetchImpl?: typeof fetch; now?: () => number } = {}
): Promise<PartCost | null> {
  const listing = await findPartListing(deviceModel, repairType, ctx)
  if (!listing) return null
  const admin = await getPartCostByHandle(listing.handle, ctx)
  const base = { handle: listing.handle, currency: listing.currency, availableForSale: listing.availableForSale }
  if (admin.status === 'ok') return { ...base, partCost: admin.partCost, costSource: 'admin_metafield', costConfirmed: true }
  return { ...base, partCost: listing.listedPrice, costSource: 'storefront_listed_price', costConfirmed: false }
}
