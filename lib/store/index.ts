/**
 * Resolves the ticket store.
 *  - Upstash Redis when configured (required on Vercel: preview + production).
 *  - In-memory only for local dev / tests.
 *  - Otherwise null: endpoints that need persistence return 503 instead of
 *    silently keeping tickets in memory.
 */
import { isLocalDevOrTest } from '../config'
import { createMemoryStore } from './memory'
import { createUpstashStore, getUpstashConfig } from './upstash'
import type { TicketStore } from './types'

export type { Ticket, TicketEvent, TicketStatus, TicketStore } from './types'

let override: TicketStore | null = null
let devMemory: TicketStore | null = null

/** Test hook. */
export function setTicketStoreForTests(store: TicketStore | null) {
  override = store
}

export function getTicketStore(env: Record<string, string | undefined> = process.env): TicketStore | null {
  if (override) return override
  const upstash = getUpstashConfig(env)
  if (upstash) return createUpstashStore(upstash)
  if (isLocalDevOrTest(env)) {
    devMemory ??= createMemoryStore()
    return devMemory
  }
  return null
}

export function newTicketId(prefix: 'T1' | 'T2' | 'T3'): string {
  const rand = crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()
  return `DCP-${prefix}-${Date.now().toString(36).toUpperCase()}-${rand}`
}
