import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { Analytics } from '@vercel/analytics/next'
import { SpeedInsights } from '@vercel/speed-insights/next'
import { connection } from 'next/server'
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
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  )
}
