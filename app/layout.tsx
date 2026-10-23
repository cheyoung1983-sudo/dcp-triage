import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { Analytics } from '@vercel/analytics/next'
import { SpeedInsights } from '@vercel/speed-insights/next'
import { connection } from 'next/server'
import { BUSINESS_PHONE_DISPLAY, BUSINESS_PHONE_E164, PRIVACY_POLICY_URL, SMS_TERMS_URL } from '@/lib/config'
import './globals.css'

export const metadata: Metadata = {
  title: 'dcp-triage',
  description: 'Display & Cell Pros triage app - Describe what is wrong with your phone and get a repair tier and next steps.',
  openGraph: {
    title: 'dcp-triage',
    description: 'Display & Cell Pros triage app - Describe what is wrong with your phone and get a repair tier and next steps.',
  },
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Render per request so Next.js can apply the CSP nonce from proxy.ts to its scripts.
  await connection()
  return (
    <html lang="en">
      <body>
        {children}
        <footer className="site-footer">
          <a href={PRIVACY_POLICY_URL}>Privacy Policy</a> · <a href={SMS_TERMS_URL}>SMS Terms</a> ·{' '}
          <a href={`tel:${BUSINESS_PHONE_E164}`}>{BUSINESS_PHONE_DISPLAY}</a>
        </footer>
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  )
}
