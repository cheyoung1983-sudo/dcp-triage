import type { TicketStore } from '../store'

export interface ToolContext {
  env?: Record<string, string | undefined>
  fetchImpl?: typeof fetch
  store?: TicketStore | null
  clientIp?: string
  now?: () => Date
}

export interface ToolResult {
  status: number
  body: Record<string, unknown>
  headers?: Record<string, string>
}

export const firstIssue = (error: { issues: { message: string; path: PropertyKey[] }[] }, fallback: string) => {
  const issue = error.issues[0]
  if (!issue) return fallback
  return issue.path.length ? `${issue.path.map(String).join('.')}: ${issue.message}` : issue.message
}

export const STORE_UNAVAILABLE: ToolResult = {
  status: 503,
  body: {
    success: false,
    error: 'Ticket storage is not configured. Do not promise a callback; ask the customer to call (509) 255-3852.',
  },
}
