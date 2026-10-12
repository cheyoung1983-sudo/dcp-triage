import { describe, expect, it } from 'vitest'
import { GET } from '@/app/api/health/route'

describe('GET /api/health', () => {
  it('returns ok', async () => {
    const res = GET()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ok', service: 'dcp-triage' })
  })
})
