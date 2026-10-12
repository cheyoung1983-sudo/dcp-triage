/**
 * READ-ONLY Shopify Storefront API client for part prices.
 *
 * Uses a separate Storefront access token with read-only scopes
 * (SHOPIFY_STOREFRONT_READONLY_TOKEN). This module only ever sends the
 * `products` query; there are no mutations anywhere in this app.
 *
 * Part cost per product: the `dcp.part_cost` metafield if the store exposes
 * it to the Storefront API, otherwise the first available variant's price.
 * When the token or domain is unset, or nothing matches, callers get
 * `null` and must say the price needs confirmation.
 */

export const STOREFRONT_API_VERSION = '2025-07'

export interface ShopifyConfig {
  domain: string
  token: string
}

export interface PartPrice {
  productTitle: string
  handle: string
  partCost: number
  currency: string
  source: 'metafield:dcp.part_cost' | 'variant_price'
  availableForSale: boolean
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
      partCost: metafield(namespace: "dcp", key: "part_cost") { value }
      variants(first: 1) { nodes { price { amount currencyCode } availableForSale } }
    }
  }
}`

interface ProductNode {
  title: string
  handle: string
  availableForSale: boolean
  partCost: { value: string } | null
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
): Promise<PartPrice[] | null> {
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
    const out: PartPrice[] = []
    for (const node of nodes) {
      const meta = node.partCost?.value ? Number(node.partCost.value) : NaN
      const variant = node.variants?.nodes?.[0]
      if (Number.isFinite(meta) && meta >= 0) {
        out.push({
          productTitle: node.title,
          handle: node.handle,
          partCost: meta,
          currency: variant?.price.currencyCode ?? 'USD',
          source: 'metafield:dcp.part_cost',
          availableForSale: node.availableForSale,
        })
      } else if (variant) {
        const amount = Number(variant.price.amount)
        if (Number.isFinite(amount) && amount >= 0) {
          out.push({
            productTitle: node.title,
            handle: node.handle,
            partCost: amount,
            currency: variant.price.currencyCode,
            source: 'variant_price',
            availableForSale: node.availableForSale && variant.availableForSale,
          })
        }
      }
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

/** Best single part price for a quotable repair, or null if unknown. */
export async function lookupPartCost(
  deviceModel: string,
  repairType: string,
  ctx: { env?: Record<string, string | undefined>; fetchImpl?: typeof fetch } = {}
): Promise<PartPrice | null> {
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
