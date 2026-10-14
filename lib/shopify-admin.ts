/**
 * SERVER-ONLY, READ-ONLY Shopify Admin API client for wholesale part cost.
 *
 * Same pattern as the storefront's lib/shopify/admin-token.ts +
 * services/shopify-admin.ts (PR #43): a Dev Dashboard app installed on the
 * store, client credentials grant (SHOPIFY_CLIENT_ID / SHOPIFY_CLIENT_SECRET)
 * -> short-lived Admin token, cached in memory and refreshed before expiry,
 * dropped and retried once on a 401. The app should have ONLY read_products.
 *
 * Only read queries are sent (mutations are rejected before any request).
 * Cost values it returns must never be sent to a client, put in a public
 * response, or logged.
 */

if (typeof window !== 'undefined') {
  throw new Error('lib/shopify-admin is server-only and must not be bundled for the browser.')
}

export const DEFAULT_ADMIN_API_VERSION = '2026-01'
export const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000

type Env = Record<string, string | undefined>

interface CachedToken {
  token: string
  expiresAt: number
  cacheKey: string
}

let cached: CachedToken | null = null
let inflight: Promise<string> | null = null
let inflightKey = ''

export function resetAdminTokenCacheForTests() {
  cached = null
  inflight = null
  inflightKey = ''
}

export interface AdminConfig {
  domain: string
  clientId: string
  clientSecret: string
  apiVersion: string
}

export function getAdminConfig(env: Env = process.env): AdminConfig | null {
  const domain = (env.SHOPIFY_STORE_DOMAIN || '').trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '').toLowerCase()
  const clientId = (env.SHOPIFY_CLIENT_ID || '').trim()
  const clientSecret = (env.SHOPIFY_CLIENT_SECRET || '').trim()
  const apiVersion = (env.SHOPIFY_ADMIN_API_VERSION || '').trim() || DEFAULT_ADMIN_API_VERSION
  if (!domain || !/^[a-z0-9.-]+$/.test(domain) || !clientId || !clientSecret) return null
  if (!/^\d{4}-\d{2}$/.test(apiVersion)) return null
  return { domain, clientId, clientSecret, apiVersion }
}

class AdminError extends Error {}

async function requestToken(config: AdminConfig, fetchImpl: typeof fetch, now: () => number): Promise<CachedToken> {
  const res = await fetchImpl(`https://${config.domain}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: config.clientId, client_secret: config.clientSecret }).toString(),
    signal: AbortSignal.timeout(8_000),
  })
  const body = (await res.json().catch(() => null)) as { access_token?: string; expires_in?: number } | null
  if (!res.ok || !body?.access_token) throw new AdminError(`token request failed (HTTP ${res.status})`)
  const lifetimeMs = Math.max(0, Number(body.expires_in) || 0) * 1000
  const margin = Math.min(TOKEN_REFRESH_MARGIN_MS, Math.floor(lifetimeMs * 0.1))
  return { token: String(body.access_token), expiresAt: now() + lifetimeMs - margin, cacheKey: `${config.domain}|${config.clientId}` }
}

export async function getAdminToken(
  config: AdminConfig,
  opts: { fetchImpl?: typeof fetch; now?: () => number; forceRefresh?: boolean } = {}
): Promise<string> {
  const now = opts.now ?? Date.now
  const key = `${config.domain}|${config.clientId}`
  if (opts.forceRefresh) cached = null
  if (cached && cached.cacheKey === key && now() < cached.expiresAt) return cached.token
  if (inflight && inflightKey === key) return inflight
  inflightKey = key
  const request = requestToken(config, opts.fetchImpl ?? fetch, now)
    .then((fresh) => {
      cached = fresh
      return fresh.token
    })
    .finally(() => {
      if (inflight === request) {
        inflight = null
        inflightKey = ''
      }
    })
  inflight = request
  return request
}

export type AdminGraphqlResult<T> = { status: 'ok'; data: T } | { status: 'not_configured' } | { status: 'error' }

/**
 * Runs one read-only Admin GraphQL query. Never throws; logs only the HTTP
 * status or error class, never variables, values or tokens.
 */
export async function adminQuery<T>(
  query: string,
  variables: Record<string, unknown>,
  ctx: { env?: Env; fetchImpl?: typeof fetch; now?: () => number } = {}
): Promise<AdminGraphqlResult<T>> {
  if (/^\s*mutation\b/i.test(query)) throw new Error('Admin mutations are not allowed in dcp-triage')
  const config = getAdminConfig(ctx.env)
  if (!config) return { status: 'not_configured' }
  const fetchImpl = ctx.fetchImpl ?? fetch
  const url = `https://${config.domain}/admin/api/${config.apiVersion}/graphql.json`
  const post = (token: string) =>
    fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-Shopify-Access-Token': token },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(8_000),
    })
  try {
    let res = await post(await getAdminToken(config, ctx))
    if (res.status === 401) res = await post(await getAdminToken(config, { ...ctx, forceRefresh: true }))
    if (!res.ok) {
      console.warn(`[dcp-triage] Shopify Admin query failed (HTTP ${res.status})`)
      return { status: 'error' }
    }
    const json = (await res.json()) as { data?: T; errors?: unknown }
    if (json.errors || !json.data) {
      console.warn('[dcp-triage] Shopify Admin query returned GraphQL errors')
      return { status: 'error' }
    }
    return { status: 'ok', data: json.data }
  } catch (err) {
    console.warn(`[dcp-triage] Shopify Admin query error (${err instanceof AdminError ? err.message : 'network error'})`)
    return { status: 'error' }
  }
}
