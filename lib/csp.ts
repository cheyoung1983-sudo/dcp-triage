/** Content-Security-Policy builders. Pages get a per-request nonce; API responses get a locked-down policy. */
export const API_CSP = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"

/**
 * @param authOrigin Auth0 tenant origin (e.g. https://tenant.us.auth0.com). When set, it is allowed
 *   as a form-action target so /auth/login and /auth/logout redirects to Auth0 are not blocked.
 */
export function pageCsp(nonce: string, isDev = false, authOrigin?: string | null): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ''}`,
    // Next.js and React inject small inline styles; no third-party styles are loaded.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src 'self'${isDev ? ' ws:' : ''}`,
    "object-src 'none'",
    "base-uri 'self'",
    `form-action 'self'${authOrigin ? ` ${authOrigin}` : ''}`,
    "frame-ancestors 'none'",
    'upgrade-insecure-requests',
  ].join('; ')
}
