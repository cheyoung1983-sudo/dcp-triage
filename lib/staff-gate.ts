/** Route classification + fail-closed responses for the Auth0 staff gate (used by proxy.ts). */
export const STAFF_PREFIXES = ['/admin']
export const AUTH_PREFIX = '/auth'

const matches = (p: string, prefix: string) => p === prefix || p.startsWith(prefix + '/')

export function isStaffPath(pathname: string): boolean {
  return STAFF_PREFIXES.some((p) => matches(pathname, p))
}
export function isAuthPath(pathname: string): boolean {
  return matches(pathname, AUTH_PREFIX)
}

export const NOT_CONFIGURED_BODY = 'Login is not configured.'

export function notConfiguredResponse(csp: string): Response {
  return new Response(NOT_CONFIGURED_BODY, {
    status: 503,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow',
      'Content-Security-Policy': csp,
    },
  })
}
