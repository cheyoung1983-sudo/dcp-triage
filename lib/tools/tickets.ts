/** Authenticated ticket lookups (replaces rev5's in-memory /api/intake/tool-events log). */
import { getTicketStore } from '../store'
import { STORE_UNAVAILABLE, type ToolContext, type ToolResult } from './types'

export async function getTicketTool(id: string, ctx: ToolContext = {}): Promise<ToolResult> {
  const store = ctx.store !== undefined ? ctx.store : getTicketStore(ctx.env)
  if (!store) return STORE_UNAVAILABLE
  if (!/^[A-Za-z0-9-]{1,64}$/.test(id)) return { status: 400, body: { success: false, error: 'Invalid ticket id' } }
  const ticket = await store.get(id)
  return ticket ? { status: 200, body: { success: true, ticket } } : { status: 404, body: { success: false, error: 'Not found' } }
}

export async function listTicketsTool(limitRaw: string | null, ctx: ToolContext = {}): Promise<ToolResult> {
  const store = ctx.store !== undefined ? ctx.store : getTicketStore(ctx.env)
  if (!store) return STORE_UNAVAILABLE
  const limit = Math.min(100, Math.max(1, Number.parseInt(limitRaw || '25', 10) || 25))
  return { status: 200, body: { success: true, store: store.kind, tickets: await store.listRecent(limit) } }
}
