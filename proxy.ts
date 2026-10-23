import { NextResponse, type NextRequest } from 'next/server'
import { pageCsp } from './lib/csp'
import { auth0Host, getAuth0, isStaff } from './lib/auth0'
import { isAuthPath, isStaffPath, notConfiguredResponse } from './lib/staff-gate'

// Adds a nonce-based Content-Security-Policy to every page response, and gates
// the staff-only pages (/admin) behind Auth0. The public triage flow and all
// /api/* routes are untouched (API routes keep the agent-secret guard).
export async function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64')
  const host = auth0Host()
  const csp = pageCsp(nonce, process.env.NODE_ENV === 'development', host ? `https://${host}` : null)
  const pathname = request.nextUrl.pathname
  const gated = isAuthPath(pathname) || isStaffPath(pathname)

  let authRes: NextResponse | null = null
  if (gated) {
    const auth0 = getAuth0()
    // Fail closed: no credentials, no login and no staff pages.
    if (!auth0) return notConfiguredResponse(csp)
    authRes = await auth0.middleware(request)
    if (isAuthPath(pathname)) {
      authRes.headers.set('Content-Security-Policy', csp)
      authRes.headers.set('Cache-Control', 'no-store')
      return authRes
    }
    const session = await auth0.getSession(request)
    if (!session) {
      const login = new URL('/auth/login', request.nextUrl.origin)
      login.searchParams.set('returnTo', pathname + request.nextUrl.search)
      return NextResponse.redirect(login)
    }
    if (!isStaff(session.user)) {
      return new NextResponse('Forbidden: this account is not on the staff list.', {
        status: 403,
        headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': csp },
      })
    }
  }

  const headers = new Headers(request.headers)
  headers.set('x-nonce', nonce)
  headers.set('Content-Security-Policy', csp)
  const response = NextResponse.next({ request: { headers } })
  response.headers.set('Content-Security-Policy', csp)
  if (authRes) {
    // Keep the SDK's rolling-session cookies.
    for (const c of authRes.headers.getSetCookie()) response.headers.append('set-cookie', c)
    response.headers.set('Cache-Control', 'private, no-store')
    response.headers.set('X-Robots-Tag', 'noindex, nofollow')
  }
  return response
}

export const config = {
  matcher: [
    {
      source: '/((?!api|_next/static|_next/image|favicon.ico).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
}
