/**
 * dispatch_booking_link tool (ported from rev5 + PR #45 hardening).
 * Texts the estimate for an existing quoted ticket. The price always comes
 * from the stored ticket, never from the agent, and Tier 3 tickets are refused.
 */
import { z } from 'zod'
import { BUSINESS_PHONE_DISPLAY, SERVICES_FAQ_URL } from '../config'
import { normalizeUsPhone } from '../phone'
import { hashKey } from '../rate-limit'
import { createSharedLimiter } from '../shared-limit'
import { getTicketStore } from '../store'
import { TIERS } from '../tiers'
import { getTwilioConfig, sendTwilioSms } from '../twilio'
import { firstIssue, STORE_UNAVAILABLE, type ToolContext, type ToolResult } from './types'

const HOUR = 60 * 60 * 1000
export const SMS_LIMITS = { perPhonePerHour: 3, perIpPerHour: 10, perInstancePerDay: 100 }
export const phoneLimiter = createSharedLimiter({ name: 'sms-phone', limit: SMS_LIMITS.perPhonePerHour, windowSeconds: HOUR / 1000, failOpen: false })
export const ipLimiter = createSharedLimiter({ name: 'sms-ip', limit: SMS_LIMITS.perIpPerHour, windowSeconds: HOUR / 1000, failOpen: false })
export const dailyLimiter = createSharedLimiter({ name: 'sms-daily', limit: SMS_LIMITS.perInstancePerDay, windowSeconds: (24 * HOUR) / 1000, failOpen: false })

export function resetSmsLimiters() {
  phoneLimiter.reset()
  ipLimiter.reset()
  dailyLimiter.reset()
}

export const DispatchSchema = z.object({
  ticket_id: z.string().trim().min(1).max(64),
  customer_name: z.string().trim().min(1).max(200),
  customer_phone: z.string().max(32),
  customer_email: z.string().trim().email().max(254).optional(),
})

export function buildSmsBody(params: { tierLabel: string; total: number; tripFee: number; ticketId: string }): string {
  const price = params.tripFee
    ? `$${params.total} (includes $${params.tripFee} mobile trip fee)`
    : `$${params.total}`
  return (
    `Display & Cell Pros: Your ${params.tierLabel} repair estimate is ${price}, before tax. Ref ${params.ticketId}. ` +
    `Details and next steps: ${SERVICES_FAQ_URL} ` +
    `Questions? Call ${BUSINESS_PHONE_DISPLAY}. Reply STOP to opt out.`
  )
}

export async function dispatchTool(input: unknown, ctx: ToolContext = {}): Promise<ToolResult> {
  const env = ctx.env ?? process.env
  const ipCheck = await ipLimiter.consume(hashKey(`ip:${ctx.clientIp ?? 'unknown'}`))
  if (!ipCheck.allowed) {
    return {
      status: 429,
      body: { success: false, smsSent: false, error: 'Too many requests' },
      headers: { 'Retry-After': String(ipCheck.retryAfterSeconds) },
    }
  }

  const parsed = DispatchSchema.safeParse(input ?? {})
  if (!parsed.success) {
    return { status: 400, body: { success: false, smsSent: false, error: firstIssue(parsed.error, 'Invalid dispatch request') } }
  }
  const phone = normalizeUsPhone(parsed.data.customer_phone)
  if (!phone) {
    return { status: 400, body: { success: false, smsSent: false, error: 'customer_phone must be a valid US number, e.g. (509) 255-3852' } }
  }

  const store = ctx.store !== undefined ? ctx.store : getTicketStore(env)
  if (!store) return STORE_UNAVAILABLE

  const ticket = await store.get(parsed.data.ticket_id)
  if (!ticket) return { status: 404, body: { success: false, smsSent: false, error: 'Unknown ticket_id. Call get_repair_quote first.' } }
  if (ticket.tier === 'TIER_3') {
    return { status: 409, body: { success: false, smsSent: false, error: 'Tier 3 tickets never get a price by text. Use escalate_tier3_ticket.' } }
  }
  if (!ticket.quote || ticket.quote.costConfirmed !== true) {
    return { status: 409, body: { success: false, smsSent: false, error: 'This ticket has no confirmed price, so no price can be texted. Tell the customer a technician will confirm the price.' } }
  }

  const twilio = getTwilioConfig(env)
  if (!twilio) {
    return { status: 503, body: { success: false, smsSent: false, error: 'SMS is not configured. Do not tell the customer a text was sent.' } }
  }

  const phoneCheck = await phoneLimiter.consume(hashKey(`phone:${phone}`))
  if (!phoneCheck.allowed) {
    return {
      status: 429,
      body: { success: false, smsSent: false, error: 'This number has already received the maximum texts for this hour.' },
      headers: { 'Retry-After': String(phoneCheck.retryAfterSeconds) },
    }
  }
  const dailyCheck = await dailyLimiter.consume('daily')
  if (!dailyCheck.allowed) {
    return {
      status: 429,
      body: { success: false, smsSent: false, error: `Daily SMS limit reached. Ask the customer to call ${BUSINESS_PHONE_DISPLAY}.` },
      headers: { 'Retry-After': String(dailyCheck.retryAfterSeconds) },
    }
  }

  const body = buildSmsBody({ tierLabel: TIERS[ticket.tier].label, total: ticket.quote.total, tripFee: ticket.quote.tripFee, ticketId: ticket.id })
  const result = await sendTwilioSms(twilio, phone, body, ctx.fetchImpl ?? fetch)
  const at = (ctx.now?.() ?? new Date()).toISOString()
  const customer = { name: parsed.data.customer_name, phone, email: parsed.data.customer_email }

  if (!result.sent) {
    await store.update(ticket.id, { customer }, { at, type: 'sms_failed', detail: { providerStatus: result.status ?? null } })
    console.error(`[dcp-triage] Twilio send failed for ${ticket.id} (status ${result.status ?? 'network error'})`)
    return { status: 502, body: { success: false, ticket_id: ticket.id, smsSent: false, error: 'The text could not be sent. Do not tell the customer it was sent.' } }
  }

  await store.update(ticket.id, { customer, status: 'link_sent' }, { at, type: 'sms_sent' })
  return { status: 200, body: { success: true, ticket_id: ticket.id, smsSent: true, smsProvider: 'twilio', infoUrl: SERVICES_FAQ_URL } }
}
