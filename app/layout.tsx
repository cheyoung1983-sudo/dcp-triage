import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import './globals.css'

export const metadata: Metadata = {
  title: 'dcp-triage',
  description: 'Display & Cell Pros triage app - Describe what is wrong with your phone and get a repair tier and next steps.',
  openGraph: {
    title: 'dcp-triage',
    description: 'Display & Cell Pros triage app - Describe what is wrong with your phone and get a repair tier and next steps.',
  },
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
