import type { Ticket, TicketStore } from './types'

/** In-memory store for tests and local `next dev` only. Never used on Vercel. */
export function createMemoryStore(): TicketStore & { clear(): void } {
  const tickets = new Map<string, Ticket>()
  return {
    kind: 'memory',
    async create(ticket) {
      if (tickets.has(ticket.id)) throw new Error(`Ticket ${ticket.id} already exists`)
      tickets.set(ticket.id, structuredClone(ticket))
    },
    async get(id) {
      const t = tickets.get(id)
      return t ? structuredClone(t) : null
    },
    async update(id, patch, event) {
      const t = tickets.get(id)
      if (!t) return null
      const next: Ticket = { ...t, ...patch, updatedAt: new Date().toISOString(), events: event ? [...t.events, event] : t.events }
      tickets.set(id, next)
      return structuredClone(next)
    },
    async listRecent(limit) {
      return [...tickets.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit).map((t) => structuredClone(t))
    },
    clear() {
      tickets.clear()
    },
  }
}
