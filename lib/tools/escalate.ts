/**
 * escalate_tier3_ticket tool (ported from rev5 + PR #45 hardening).
 * Saves the case to the ticket store (with contact details), then posts a
 * Slack alert for Ryan WITHOUT the customer's phone or email.
 */
import { z } from 'zod'
import { BUSINESS_PHONE_DISPLAY } from '../config'
import { normalizeUsPhone } from '../phone'
import { getTicketStore, newTicketId, type Ticket } from '../store'
import { firstIssue, STORE_UNAVAILABLE, type ToolContext, type ToolResult } from './types'

export const EscalateSchema = z.object({
  ticket_id: z.string().trim().max(64).optional(),
  customer_name: z.string().trim().min(1).max(200),
  customer_phone: z.string().max(32),
  customer_email: z.string().trim().email().max(254).optional(),
  device_model: z.string().trim().min(1).max(120),
  failure_symptoms: z.string().trim().min(1).max(2000),
  intake_notes: z.string().max(2000).optional().default(''),
  source: z.enum(['voice', 'web']).optional().default('voice'),
})

/** Escapes Slack mrkdwn control characters (prevents <!channel>, link injection). */
export function escapeSlack(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Removes phone numbers and email addresses from free text. */
export function redactContactInfo(text: string): string {
  return text
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email redacted]')
    .replace(/(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g, '[phone redacted]')
}

const clean = (text: string, max: number) => escapeSlack(redactContactInfo(text)).slice(0, max)

export function buildTier3SlackPayload(p: {
  ticketId: string
  customerName: string
  deviceModel: string
  failureSymptoms: string
  intakeNotes: string
}): { text: string } {
  return {
    text: [
      `:rotating_light: Tier 3 escalation ${p.ticketId}`,
      `Customer: ${clean(p.customerName, 200)}`,
      `Device: ${clean(p.deviceModel, 120)}`,
      `Symptoms: ${clean(p.failureSymptoms, 1500)}`,
      `Notes: ${p.intakeNotes ? clean(p.intakeNotes, 1500) : 'none'}`,
      `Contact details are in the ticket store under ${p.ticketId} (not included here). No quote was given.`,
    ].join('\n'),
  }
}

export function getSlackWebhookUrl(env: Record<string, string | undefined> = process.env): string | null {
  const url = (env.SLACK_ESCALATION_WEBHOOK_URL || '').trim()
  return url.startsWith('https://') ? url : null
}

export async function escalateTool(input: unknown, ctx: ToolContext = {}): Promise<ToolResult> {
  const env = ctx.env ?? process.env
  const parsed = EscalateSchema.safeParse(input ?? {})
  if (!parsed.success) return { status: 400, body: { success: false, error: firstIssue(parsed.error, 'Invalid escalation request') } }
  const d = parsed.data
  const phone = normalizeUsPhone(d.customer_phone)
  if (!phone) return { status: 400, body: { success: false, error: 'customer_phone must be a valid US number' } }

  const webhookUrl = getSlackWebhookUrl(env)
  if (!webhookUrl) {
    return {
      status: 503,
      body: { success: false, escalated: false, error: `Escalation channel is not configured. Ask the customer to call ${BUSINESS_PHONE_DISPLAY}.` },
    }
  }
  const store = ctx.store !== undefined ? ctx.store : getTicketStore(env)
  if (!store) return STORE_UNAVAILABLE

  const at = (ctx.now?.() ?? new Date()).toISOString()
  const customer = { name: d.customer_name, phone, email: d.customer_email }
  const summary = d.failure_symptoms.slice(0, 500)

  let ticketId: string
  const existing = d.ticket_id ? await store.get(d.ticket_id) : null
  if (existing) {
    ticketId = existing.id
    // Any earlier estimate is void once a case is Tier 3.
    await store.update(ticketId, { tier: 'TIER_3', status: 'escalated', customer, summary, quote: undefined }, { at, type: 'note', detail: { reclassified: 'TIER_3' } })
  } else {
    ticketId = newTicketId('T3')
    const ticket: Ticket = {
      id: ticketId,
      createdAt: at,
      updatedAt: at,
      status: 'escalated',
      tier: 'TIER_3',
      source: d.source,
      deviceModel: d.device_model,
      summary,
      customer,
      events: [{ at, type: 'created', detail: { notes: d.intake_notes ? 'present' : 'none' } }],
    }
    await store.create(ticket)
  }

  const payload = buildTier3SlackPayload({
    ticketId,
    customerName: d.customer_name,
    deviceModel: d.device_model,
    failureSymptoms: d.failure_symptoms,
    intakeNotes: d.intake_notes,
  })

  let ok = false
  let status: number | undefined
  try {
    const res = await (ctx.fetchImpl ?? fetch)(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    })
    ok = res.ok
    status = res.status
  } catch {
    ok = false
  }

  if (!ok) {
    await store.update(ticketId, {}, { at, type: 'escalation_failed', detail: { providerStatus: status ?? null } })
    console.error(`[dcp-triage] Slack escalation failed for ${ticketId} (status ${status ?? 'network error'})`)
    return {
      status: 502,
      body: {
        success: false,
        ticket_id: ticketId,
        escalated: false,
        error: `The escalation was saved but the alert could not be delivered. Do not quote a price; ask the customer to call ${BUSINESS_PHONE_DISPLAY}.`,
      },
    }
  }

  await store.update(ticketId, {}, { at, type: 'escalated', detail: { channel: 'slack' } })
  return {
    status: 200,
    body: {
      success: true,
      ticket_id: ticketId,
      escalated: true,
      message: 'Tier 3 case sent to Ryan for a callback. Do not provide a price for this repair.',
    },
  }
}
