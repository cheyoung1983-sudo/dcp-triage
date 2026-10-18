import { describe, expect, it } from 'vitest'
import { smartTriageErrorMessage } from '@/lib/triage-errors'
import { quoteTool } from '@/lib/tools/quote'
import { createMemoryStore } from '@/lib/store/memory'

describe('smart triage customer error messages', () => {
  it('rate limit and oversized bodies get plain-English messages with the phone number', () => {
    expect(smartTriageErrorMessage(429, 'Too many requests')).toMatch(/wait a few minutes.*\(509\) 255-3852/)
    expect(smartTriageErrorMessage(413)).toMatch(/too long/)
  })
  it('validation messages pass through; unknown failures never show raw errors', () => {
    expect(smartTriageErrorMessage(400, 'Describe what is happening')).toBe('Describe what is happening')
    expect(smartTriageErrorMessage(500, 'SyntaxError: Unexpected token <')).not.toMatch(/Syntax|token/)
    expect(smartTriageErrorMessage(0)).toMatch(/try again/)
  })
})

describe('quote cost_status', () => {
  it('reports no_listing when Shopify has no matching product (matches the ticket event)', async () => {
    const store = createMemoryStore()
    const r = await quoteTool({ device_model: 'iPhone 13', repair_type: 'screen_oem' }, { env: {}, store })
    expect(r.body).toMatchObject({ quote_available: false, cost_status: 'no_listing', part_found: false })
    const t = await store.get(String(r.body.ticket_id))
    expect(t?.events[0]?.detail).toMatchObject({ costStatus: 'no_listing' })
  })
})
