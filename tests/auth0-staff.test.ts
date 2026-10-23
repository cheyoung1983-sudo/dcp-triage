import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { proxy } from '@/proxy'
import { auth0Host, getAuth0, isAuth0Configured, isStaff, resetAuth0ForTests, staffEmails } from '@/lib/auth0'
import { isAuthPath, isStaffPath } from '@/lib/staff-gate'
import { pageCsp } from '@/lib/csp'

// Obviously-fake test values (not secrets).
const CONFIGURED = {
  AUTH0_DOMAIN: 'dcp-test.example.auth0.test',
  AUTH0_CLIENT_ID: 'test-client-id',
  AUTH0_CLIENT_SECRET: 'test-client-value',
  AUTH0_SECRET: 'x'.repeat(64),
  APP_BASE_URL: 'https://triage.displaycellpros.com',
  DCP_STAFF_EMAILS: 'Staff@DisplayCellPros.com, other@displaycellpros.com',
}
const ALL = Object.keys(CONFIGURED) as (keyof typeof CONFIGURED)[]

function setEnv(env: Partial<typeof CONFIGURED>) {
  for (const k of ALL) vi.stubEnv(k, env[k] ?? '')
  resetAuth0ForTests()
}
const req = (path: string) => new NextRequest(new URL(path, 'https://triage.displaycellpros.com'))

beforeEach(() => setEnv({}))
afterEach(() => { vi.unstubAllEnvs(); resetAuth0ForTests() })

describe('Auth0 config (fail closed)', () => {
  it('is not configured when any required var is missing', () => {
    expect(isAuth0Configured({})).toBe(false)
    for (const k of ['AUTH0_DOMAIN', 'AUTH0_CLIENT_ID', 'AUTH0_CLIENT_SECRET', 'AUTH0_SECRET'] as const) {
      expect(isAuth0Configured({ ...CONFIGURED, [k]: '' })).toBe(false)
    }
    expect(isAuth0Configured({ ...CONFIGURED, AUTH0_SECRET: 'short' })).toBe(false)
    expect(isAuth0Configured(CONFIGURED)).toBe(true)
  })
  it('never builds a client (no placeholders) without env', () => {
    expect(getAuth0()).toBeNull()
  })
  it('builds a client when configured', () => {
    setEnv(CONFIGURED)
    expect(getAuth0()).not.toBeNull()
  })
  it('normalizes the Auth0 host and rejects junk', () => {
    expect(auth0Host({ AUTH0_DOMAIN: 'https://t.us.auth0.com/' })).toBe('t.us.auth0.com')
    expect(auth0Host({ AUTH0_DOMAIN: 'evil.com"; script-src *' })).toBeNull()
    expect(auth0Host({})).toBeNull()
  })
})

describe('staff allow-list', () => {
  it('requires a verified email on DCP_STAFF_EMAILS', () => {
    expect(staffEmails(CONFIGURED)).toEqual(['staff@displaycellpros.com', 'other@displaycellpros.com'])
    expect(isStaff({ email: 'staff@displaycellpros.com', email_verified: true }, CONFIGURED)).toBe(true)
    expect(isStaff({ email: 'staff@displaycellpros.com', email_verified: false }, CONFIGURED)).toBe(false)
    expect(isStaff({ email: 'rando@gmail.com', email_verified: true }, CONFIGURED)).toBe(false)
    expect(isStaff({ email: 'staff@displaycellpros.com', email_verified: true }, {})).toBe(false)
    expect(isStaff(null, CONFIGURED)).toBe(false)
  })
})

describe('route classification', () => {
  it('gates only /admin and /auth', () => {
    expect(isStaffPath('/admin')).toBe(true)
    expect(isStaffPath('/admin/tickets')).toBe(true)
    expect(isStaffPath('/administrator')).toBe(false)
    expect(isStaffPath('/')).toBe(false)
    expect(isAuthPath('/auth/login')).toBe(true)
    expect(isAuthPath('/authors')).toBe(false)
  })
})

describe('CSP', () => {
  it('adds the Auth0 origin to form-action only when given', () => {
    expect(pageCsp('n')).toContain("form-action 'self';")
    expect(pageCsp('n', false, 'https://t.us.auth0.com')).toContain("form-action 'self' https://t.us.auth0.com;")
  })
})

describe('proxy gating', () => {
  it('keeps the public triage page public with a nonce CSP (no Auth0 env)', async () => {
    const res = await proxy(req('/'))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-security-policy')).toMatch(/script-src 'self' 'nonce-/)
  })
  it('returns 503 "login not configured" for /admin and /auth/* without env', async () => {
    for (const p of ['/admin', '/admin/x', '/auth/login', '/auth/callback']) {
      const res = await proxy(req(p))
      expect(res.status, p).toBe(503)
      expect(await res.text()).toMatch(/login is not configured/i)
      expect(res.headers.get('content-security-policy')).toBeTruthy()
      expect(res.headers.get('set-cookie')).toBeNull()
    }
  })
  it('fails closed when only some vars are set', async () => {
    setEnv({ AUTH0_DOMAIN: CONFIGURED.AUTH0_DOMAIN, AUTH0_CLIENT_ID: CONFIGURED.AUTH0_CLIENT_ID })
    expect((await proxy(req('/admin'))).status).toBe(503)
  })
  it('redirects anonymous /admin to /auth/login with returnTo when configured', async () => {
    setEnv(CONFIGURED)
    const res = await proxy(req('/admin?x=1'))
    expect([302, 307]).toContain(res.status)
    const loc = new URL(res.headers.get('location')!)
    expect(loc.pathname).toBe('/auth/login')
    expect(loc.searchParams.get('returnTo')).toBe('/admin?x=1')
  })
  it('/auth/login hands off to the Auth0 tenant and keeps the CSP', async () => {
    setEnv(CONFIGURED)
    const iss = `https://${CONFIGURED.AUTH0_DOMAIN}/`
    // Fake OIDC discovery so no network is needed.
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      issuer: iss,
      authorization_endpoint: `${iss}authorize`,
      token_endpoint: `${iss}oauth/token`,
      jwks_uri: `${iss}.well-known/jwks.json`,
      end_session_endpoint: `${iss}oidc/logout`,
    }), { status: 200, headers: { 'content-type': 'application/json' } })))
    const res = await proxy(req('/auth/login'))
    vi.unstubAllGlobals()
    expect([302, 307]).toContain(res.status)
    const loc = new URL(res.headers.get('location')!)
    expect(loc.host).toBe(CONFIGURED.AUTH0_DOMAIN)
    expect(loc.searchParams.get('redirect_uri')).toBe('https://triage.displaycellpros.com/auth/callback')
    expect(res.headers.get('content-security-policy')).toContain(`https://${CONFIGURED.AUTH0_DOMAIN}`)
  })
  it('public pages stay public even when Auth0 is configured', async () => {
    setEnv(CONFIGURED)
    expect((await proxy(req('/'))).status).toBe(200)
  })
})
