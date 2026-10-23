/**
 * Auth0 (staff login) for the triage app, via the official @auth0/nextjs-auth0 v4 SDK.
 *
 * Scope: ONLY the human staff surfaces (/admin) and the SDK's /auth/* routes.
 * The public customer triage flow stays public, and the agent/tool APIs keep
 * their X-DCP-Agent-Secret guard (lib/auth.ts). Nothing here replaces that.
 *
 * Fails closed: if any required env var is missing, no client is created
 * (never placeholder credentials or fake users) and protected pages return
 * 503 "Login is not configured".
 *
 * Env (names only; values are set in Vercel, see docs/AUTH0-SUBDOMAINS.md):
 *   AUTH0_DOMAIN, AUTH0_CLIENT_ID, AUTH0_CLIENT_SECRET, AUTH0_SECRET  (required)
 *   APP_BASE_URL       optional; production: https://triage.displaycellpros.com
 *                      (may be a comma-separated allow-list). Omit on previews
 *                      so the SDK infers the preview host.
 *   DCP_STAFF_EMAILS   required; comma-separated verified emails allowed into /admin.
 */
import { NextResponse } from 'next/server'
import { Auth0Client } from '@auth0/nextjs-auth0/server'

type Env = Record<string, string | undefined>

export const AUTH0_REQUIRED_ENV = ['AUTH0_DOMAIN', 'AUTH0_CLIENT_ID', 'AUTH0_CLIENT_SECRET', 'AUTH0_SECRET'] as const
export const STAFF_EMAILS_ENV = 'DCP_STAFF_EMAILS'

const val = (env: Env, k: string) => (env[k] || '').trim()

/** True only when every required Auth0 var is present and the session secret is long enough. */
export function isAuth0Configured(env: Env = process.env): boolean {
  if (AUTH0_REQUIRED_ENV.some((k) => !val(env, k))) return false
  return val(env, 'AUTH0_SECRET').length >= 32
}

export function staffEmails(env: Env = process.env): string[] {
  return val(env, STAFF_EMAILS_ENV)
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
}

/** Staff check: email must be verified by Auth0 and on the DCP_STAFF_EMAILS allow-list. Empty list = nobody. */
export function isStaff(user: { email?: unknown; email_verified?: unknown } | null | undefined, env: Env = process.env): boolean {
  if (!user || typeof user.email !== 'string' || user.email_verified !== true) return false
  return staffEmails(env).includes(user.email.trim().toLowerCase())
}

/** Normalized Auth0 domain host (accepts "tenant.us.auth0.com" or "https://tenant.us.auth0.com/"). */
export function auth0Host(env: Env = process.env): string | null {
  const d = val(env, 'AUTH0_DOMAIN').replace(/^https?:\/\//, '').replace(/\/.*$/, '')
  return /^[a-z0-9.-]+$/i.test(d) ? d : null
}

function appBaseUrl(env: Env = process.env): string | string[] | undefined {
  const list = val(env, 'APP_BASE_URL').split(',').map((u) => u.trim().replace(/^["']|["']$/g, '').replace(/\/+$/, '')).filter(Boolean)
  return list.length === 0 ? undefined : list.length === 1 ? list[0] : list
}

let client: Auth0Client | null | undefined

/** The Auth0 client, or null when not configured. Never constructed with placeholders. */
export function getAuth0(): Auth0Client | null {
  if (client !== undefined) return client
  if (!isAuth0Configured()) return (client = null)
  const host = auth0Host()
  if (!host) return (client = null)
  client = new Auth0Client({
    domain: host,
    // Pass trimmed values explicitly. The SDK reads process.env verbatim, so a
    // trailing newline/space/quote in a pasted Vercel value (common with
    // `echo ... | vercel env add`) silently breaks the token exchange
    // ("An error occurred while trying to exchange the authorization code").
    clientId: val(process.env, 'AUTH0_CLIENT_ID'),
    clientSecret: val(process.env, 'AUTH0_CLIENT_SECRET'),
    secret: val(process.env, 'AUTH0_SECRET'),
    // appBaseUrl: from APP_BASE_URL (trimmed, may be comma list), or inferred from the request host when unset (previews).
    ...(appBaseUrl() ? { appBaseUrl: appBaseUrl() } : {}),
    onCallback: async (error, ctx) => {
      if (error) {
        // Log the code and Auth0's reason (e.g. invalid_client, invalid_grant), never secrets.
        const cause = (error as { cause?: { code?: string; message?: string } }).cause
        console.error('[auth0] callback failed', JSON.stringify({ code: error.code, message: error.message, cause: cause ? { code: cause.code, message: cause.message } : undefined }))
        return new NextResponse('Sign-in failed. Please go back to /admin and try again.', { status: 500, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
      }
      const base = ctx.appBaseUrl || 'https://triage.displaycellpros.com'
      return NextResponse.redirect(new URL(ctx.returnTo || '/admin', base))
    },
    signInReturnToPath: '/admin',
    session: { rolling: true, absoluteDuration: 60 * 60 * 12, inactivityDuration: 60 * 60 * 2 },
  })
  return client
}

/** Test hook. */
export function resetAuth0ForTests() {
  client = undefined
}
