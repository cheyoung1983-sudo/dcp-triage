/**
 * Persistent ticket store on Upstash Redis via its REST API (no SDK).
 * Works with a Vercel Marketplace Upstash integration (KV_REST_API_URL /
 * KV_REST_API_TOKEN) or a direct Upstash database (UPSTASH_REDIS_REST_URL /
 * UPSTASH_REDIS_REST_TOKEN).
 *
 * Layout: `dcp:ticket:<id>` -> JSON, `dcp:tickets` sorted set scored by createdAt ms.
 */
import type { Ticket, TicketStore } from './types'

export interface UpstashConfig {
  url: string
  token: string
}

export function getUpstashConfig(env: Record<string, string | undefined> = process.env): UpstashConfig | null {
  const url = (env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL || '').trim().replace(/\/+$/, '')
  const token = (env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN || '').trim()
  if (!url.startsWith('https://') || !token) return null
  return { url, token }
}

const KEY = (id: string) => `dcp:ticket:${id}`
const INDEX = 'dcp:tickets'

export function createUpstashStore(config: UpstashConfig, fetchImpl: typeof fetch = fetch): TicketStore {
  async function pipeline(commands: (string | number)[][]): Promise<unknown[]> {
    const res = await fetchImpl(`${config.url}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(commands),
      signal: AbortSignal.timeout(8_000),
    })
    if (!res.ok) throw new Error(`Ticket store request failed (${res.status})`)
    const out = (await res.json()) as { result?: unknown; error?: string }[]
    const failed = out.find((r) => r.error)
    if (failed) throw new Error('Ticket store command failed')
    return out.map((r) => r.result)
  }

  const store: TicketStore = {
    kind: 'upstash-redis',
    async create(ticket) {
      const [setResult] = await pipeline([['SET', KEY(ticket.id), JSON.stringify(ticket), 'NX']])
      if (setResult !== 'OK') throw new Error(`Ticket ${ticket.id} already exists`)
      // Index only after the ticket itself is saved, so a duplicate can't reorder the list.
      await pipeline([['ZADD', INDEX, Date.parse(ticket.createdAt), ticket.id]])
    },
    async get(id) {
      const [raw] = await pipeline([['GET', KEY(id)]])
      return typeof raw === 'string' ? (JSON.parse(raw) as Ticket) : null
    },
    async update(id, patch, event) {
      // Single-writer per ticket in practice (one agent call at a time); last write wins.
      const current = await store.get(id)
      if (!current) return null
      const next: Ticket = {
        ...current,
        ...patch,
        updatedAt: new Date().toISOString(),
        events: event ? [...current.events, event] : current.events,
      }
      await pipeline([['SET', KEY(id), JSON.stringify(next), 'XX']])
      return next
    },
    async listRecent(limit) {
      const [ids] = await pipeline([['ZRANGE', INDEX, 0, Math.max(0, limit - 1), 'REV']])
      if (!Array.isArray(ids) || ids.length === 0) return []
      const [raws] = await pipeline([['MGET', ...ids.map((i) => KEY(String(i)))]])
      return (Array.isArray(raws) ? raws : []).filter((r): r is string => typeof r === 'string').map((r) => JSON.parse(r) as Ticket)
    },
  }
  return store
}
