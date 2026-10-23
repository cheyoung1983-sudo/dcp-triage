import type { NextConfig } from 'next'
import { API_CSP } from './lib/csp'

const nextConfig: NextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  // Legal pages live on the storefront (single source of truth); short links here for the intake form.
  async redirects() {
    return [
      { source: '/privacy', destination: 'https://www.displaycellpros.com/policies/privacy-policy', permanent: false },
      { source: '/privacy-policy', destination: 'https://www.displaycellpros.com/policies/privacy-policy', permanent: false },
      { source: '/sms-terms', destination: 'https://www.displaycellpros.com/sms-terms', permanent: false },
    ]
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },
      {
        source: '/api/:path*',
        headers: [
          { key: 'Cache-Control', value: 'no-store' },
          { key: 'Content-Security-Policy', value: API_CSP },
        ],
      },
    ]
  },
}

export default nextConfig
