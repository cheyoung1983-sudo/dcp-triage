/**
 * READ-ONLY Shopify part lookups, entirely through the Admin API
 * (./shopify-admin: client credentials, read_products only). No Storefront
 * token is used.
 *
 * One query returns, per product: title, handle, status, Online Store
 * publication, first variant listed price + availableForSale +
 * inventoryPolicy, and the `dcp.part_cost` metafield (wholesale cost).
 *
 * `partCost` is server-only: it must never be returned by an endpoint,
 * stored on a ticket, or logged. Inventory quantities are never requested.
 * If the Admin app isn't configured or errors, or the metafield is missing,
 * quotes say the price needs confirmation (no number).
 */
import { adminQuery } from './shopify-admin'

type Ctx = { env?: Record<string, string | undefined>; fetchImpl?: typeof fetch; now?: () => number }

export interface PartListing {
  productTitle: string
  handle: string
  listedPrice: number
  currency: string
  availableForSale: boolean
}

export type CostSource = 'admin_metafield'

/**
 * Server-only. `partCost` exists ONLY when confirmed by the dcp.part_cost
 * metafield and must never leave the server. The listed (retail) price is
 * never used as a cost.
 */
export type PartCost =
  | { handle: string; currency: string; availableForSale: boolean; costConfirmed: true; partCost: number; costSource: CostSource }
  | { handle: string; currency: string; availableForSale: boolean; costConfirmed: false }

interface InternalListing extends PartListing {
  metafieldCost: number | null
}

export const PARTS_QUERY = `query DcpParts($query: String!) {
  shop { currencyCode }
  products(first: 5, query: $query) {
    nodes {
      title
      handle
      status
      publishedAt
      partCost: metafield(namespace: "dcp", key: "part_cost") { value }
      variants(first: 1) { nodes { price availableForSale inventoryPolicy } }
    }
  }
}`

interface ProductNode {
  title: string
  handle: string
  status: string
  publishedAt: string | null
  partCost: { value: string } | null
  variants: { nodes: { price: string; availableForSale: boolean; inventoryPolicy: 'DENY' | 'CONTINUE' }[] }
}

/** Escapes free-text terms for Shopify's search syntax; only ACTIVE products. */
export function buildSearchQuery(deviceModel: string, partKeyword: string): string {
  const clean = (s: string) => s.replace(/["\\:()]/g, ' ').replace(/\s+/g, ' ').trim()
  const terms = [clean(deviceModel), clean(partKeyword)].filter(Boolean).map((t) => `"${t}"`)
  return [...terms, 'status:active'].join(' AND ')
}

async function searchInternal(deviceModel: string, partKeyword: string, ctx: Ctx): Promise<InternalListing[] | null> {
  const res = await adminQuery<{ shop: { currencyCode: string }; products: { nodes: ProductNode[] } }>(
    PARTS_QUERY,
    { query: buildSearchQuery(deviceModel, partKeyword) },
    ctx
  )
  if (res.status !== 'ok') return null
  const currency = res.data.shop?.currencyCode || 'USD'
  const out: InternalListing[] = []
  for (const node of res.data.products?.nodes ?? []) {
    const variant = node.variants?.nodes?.[0]
    const price = variant ? Number(variant.price) : NaN
    if (!variant || !Number.isFinite(price) || price < 0) continue
    const published = Boolean(node.publishedAt) // published to the Online Store
    const sellable = variant.availableForSale || variant.inventoryPolicy === 'CONTINUE'
    const meta = node.partCost?.value != null ? Number(node.partCost.value) : NaN
    out.push({
      productTitle: node.title,
      handle: node.handle,
      listedPrice: price,
      currency,
      availableForSale: node.status === 'ACTIVE' && published && sellable,
      metafieldCost: Number.isFinite(meta) && meta >= 0 ? meta : null,
    })
  }
  return out
}

/** Public-safe listing search (no cost fields). null = Shopify not configured or failed. */
export async function searchPartProducts(deviceModel: string, partKeyword: string, ctx: Ctx = {}): Promise<PartListing[] | null> {
  const results = await searchInternal(deviceModel, partKeyword, ctx)
  return results?.map(({ productTitle, handle, listedPrice, currency, availableForSale }) => ({ productTitle, handle, listedPrice, currency, availableForSale })) ?? null
}

export const PART_KEYWORDS: Record<string, string> = {
  battery: 'battery',
  charging_port: 'charging port',
  screen_aftermarket: 'screen',
  screen_oem: 'screen',
  camera: 'camera',
  back_glass: 'back glass',
}

const OEM_RE = /\b(oem|genuine|original|service pack)\b/i

function pick<T extends PartListing>(results: T[], repairType: string): T {
  if (repairType === 'screen_oem') return results.find((r) => OEM_RE.test(r.productTitle)) ?? results[0]
  if (repairType === 'screen_aftermarket') return results.find((r) => !OEM_RE.test(r.productTitle)) ?? results[0]
  return results[0]
}

/**
 * Server-only: part cost for a quote. Only the `dcp.part_cost` metafield
 * counts as a cost. Without it the result is costConfirmed: false with no
 * number (availability only). null = no matching product / Shopify unavailable.
 */
export async function lookupPartCost(deviceModel: string, repairType: string, ctx: Ctx = {}): Promise<PartCost | null> {
  const keyword = PART_KEYWORDS[repairType]
  if (!keyword) return null
  const results = await searchInternal(deviceModel, keyword, ctx)
  if (!results?.length) return null
  const best = pick(results, repairType)
  const base = { handle: best.handle, currency: best.currency, availableForSale: best.availableForSale }
  if (best.metafieldCost !== null) return { ...base, costConfirmed: true, partCost: best.metafieldCost, costSource: 'admin_metafield' }
  return { ...base, costConfirmed: false }
}
