import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/** Public liveness check. Reports nothing about configuration or secrets. */
export function GET() {
  return NextResponse.json({ status: 'ok', service: 'dcp-triage' })
}
