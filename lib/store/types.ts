import type { TierId } from '../tiers'

export type TicketStatus = 'new' | 'quoted' | 'link_sent' | 'escalated' | 'closed'

export interface TicketEvent {
  at: string
  type: 'created' | 'quote' | 'sms_sent' | 'sms_failed' | 'escalated' | 'escalation_failed' | 'note'
  detail?: Record<string, unknown>
}

export interface Ticket {
  id: string
  createdAt: string
  updatedAt: string
  status: TicketStatus
  tier: TierId
  source: 'voice' | 'web'
  deviceModel: string
  summary: string
  /** Customer contact details. Stored only in the private ticket store, never sent to Slack or logs. */
  customer?: { name?: string; phone?: string; email?: string }
  /**
   * SMS opt-in from the web intake form (A2P 10DLC consent record). granted=false
   * means the customer did not check the box: never text this ticket.
   */
  smsConsent?: { granted: boolean; at: string; source: 'web_form'; text: string }
  /** Never stores the wholesale part cost itself. */
  quote?: { total: number; repairPrice: number; tripFee: number; costSource: 'admin_metafield'; costConfirmed: true }
  events: TicketEvent[]
}

export interface TicketStore {
  readonly kind: 'memory' | 'upstash-redis'
  create(ticket: Ticket): Promise<void>
  get(id: string): Promise<Ticket | null>
  update(id: string, patch: Partial<Omit<Ticket, 'id' | 'createdAt' | 'events'>>, event?: TicketEvent): Promise<Ticket | null>
  listRecent(limit: number): Promise<Ticket[]>
}
