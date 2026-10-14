import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { connection } from 'next/server'
import './globals.css'

export const metadata: Metadata = {
  title: 'Get a diagnosis | Display & Cell Pros',
  description: 'Describe what is wrong with your phone and get a repair tier and next steps from Display & Cell Pros.',
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Render per request so Next.js can apply the CSP nonce from proxy.ts to its scripts.
  await connection()
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
