import { describe, expect, it } from 'vitest'
import { createUpstashStore } from '@/lib/store/upstash'
import type { Ticket } from '@/lib/store'

/** Tiny fake of the Upstash REST /pipeline endpoint backed by a Map. */
function fakeUpstash() {
  const kv = new Map<string, string>()
  const zset = new Map<string, number>()
  const calls: unknown[] = []
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok')
    const cmds = JSON.parse(String(init.body)) as (string | number)[][]
    calls.push(cmds)
    const out = cmds.map(([cmd, ...a]) => {
      switch (cmd) {
        case 'SET': {
          const [k, v, mode] = a as string[]
          if (mode === 'NX' && kv.has(k)) return { result: null }
          if (mode === 'XX' && !kv.has(k)) return { result: null }
          kv.set(k, v)
          return { result: 'OK' }
        }
        case 'GET':
          return { result: kv.get(String(a[0])) ?? null }
        case 'ZADD':
          zset.set(String(a[2]), Number(a[1]))
          return { result: 1 }
        case 'ZRANGE':
          return { result: [...zset.entries()].sort((x, y) => y[1] - x[1]).map(([id]) => id).slice(0, Number(a[2]) + 1) }
        case 'MGET':
          return { result: a.map((k) => kv.get(String(k)) ?? null) }
        default:
          return { error: 'unsupported' }
      }
    })
    return new Response(JSON.stringify(out), { status: 200 })
  }) as unknown as typeof fetch
  return { fetchImpl, kv, calls }
}

const ticket = (id: string, createdAt: string): Ticket => ({
  id,
  createdAt,
  updatedAt: createdAt,
  status: 'quoted',
  tier: 'TIER_1',
  source: 'voice',
  deviceModel: 'iPhone 13',
  summary: 'battery',
  events: [{ at: createdAt, type: 'created' }],
})

describe('Upstash ticket store', () => {
  it('persists, updates with events, rejects duplicates, and lists newest first', async () => {
    const { fetchImpl } = fakeUpstash()
    const store = createUpstashStore({ url: 'https://example.upstash.io', token: 'tok' }, fetchImpl)
    await store.create(ticket('A', '2026-10-11T10:00:00.000Z'))
    await store.create(ticket('B', '2026-10-11T11:00:00.000Z'))
    await expect(store.create(ticket('A', '2026-10-11T12:00:00.000Z'))).rejects.toThrow(/already exists/)

    const updated = await store.update('A', { status: 'link_sent' }, { at: '2026-10-11T10:05:00.000Z', type: 'sms_sent' })
    expect(updated?.status).toBe('link_sent')
    expect((await store.get('A'))?.events.map((e) => e.type)).toEqual(['created', 'sms_sent'])
    expect(await store.update('missing', { status: 'closed' })).toBeNull()

    expect((await store.listRecent(10)).map((t) => t.id)).toEqual(['B', 'A'])
  })

  it('throws on HTTP errors instead of pretending to save', async () => {
    const store = createUpstashStore({ url: 'https://example.upstash.io', token: 'tok' }, (async () => new Response('x', { status: 500 })) as unknown as typeof fetch)
    await expect(store.create(ticket('A', '2026-10-11T10:00:00.000Z'))).rejects.toThrow(/500/)
  })
})
