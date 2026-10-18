/**
 * get_repair_quote tool.
 * Tier 3 is refused (never a binding quote). Tier 1/2 use the V4 engine with
 * the part cost read from Shopify; if Shopify has no price, the quote is
 * "price needs confirmation" and no number is given.
 */
import { z } from 'zod'
import { calculateV4Quote } from '../pricing'
import { lookupPartCost } from '../shopify'
import { getTicketStore, newTicketId, type Ticket } from '../store'
import { REPAIR_TYPE_LIST, TIERS, isQuotable, tierForRepairType } from '../tiers'
import { BUSINESS_PHONE_DISPLAY } from '../config'
import { firstIssue, STORE_UNAVAILABLE, type ToolContext, type ToolResult } from './types'

export const QuoteSchema = z.object({
  device_model: z.string().trim().min(1).max(120),
  repair_type: z.enum(REPAIR_TYPE_LIST),
  mobile_service: z.boolean().optional().default(false),
  source: z.enum(['voice', 'web']).optional().default('voice'),
})

export const TIER3_ESCALATION_MESSAGE =
  'This is a Tier 3 repair (logic board, liquid damage, no power or data recovery). Do not quote a price. ' +
  'Escalate it with escalate_tier3_ticket so Ryan can review it and call the customer back.'

export async function quoteTool(input: unknown, ctx: ToolContext = {}): Promise<ToolResult> {
  const parsed = QuoteSchema.safeParse(input ?? {})
  if (!parsed.success) return { status: 400, body: { success: false, error: firstIssue(parsed.error, 'Invalid quote request') } }
  const { device_model, repair_type, mobile_service, source } = parsed.data
  const tier = tierForRepairType(repair_type)

  if (!isQuotable(tier)) {
    return {
      status: 200,
      body: {
        success: false,
        quote_available: false,
        tier: TIERS[tier].label,
        requires_escalation: true,
        escalation_tool: 'escalate_tier3_ticket',
        message: TIER3_ESCALATION_MESSAGE,
      },
    }
  }

  const store = ctx.store !== undefined ? ctx.store : getTicketStore(ctx.env)
  if (!store) return STORE_UNAVAILABLE

  const part = await lookupPartCost(device_model, repair_type, { env: ctx.env, fetchImpl: ctx.fetchImpl })
  const now = (ctx.now?.() ?? new Date()).toISOString()
  const ticketId = newTicketId(tier === 'TIER_1' ? 'T1' : 'T2')

  if (!part || !part.costConfirmed) {
    // No metafield-confirmed cost: never derive a number (the listed price is retail, not cost).
    const ticket: Ticket = {
      id: ticketId,
      createdAt: now,
      updatedAt: now,
      status: 'quoted',
      tier,
      source,
      deviceModel: device_model,
      summary: `${repair_type} (price needs confirmation)`,
      events: [
        {
          at: now,
          type: 'created',
          detail: { repairType: repair_type, priceNeedsConfirmation: true, costStatus: part ? 'cost_unconfirmed' : 'no_listing', ...(part ? { product: part.handle } : {}) },
        },
      ],
    }
    await store.create(ticket)
    return {
      status: 200,
      body: {
        success: true,
        ticket_id: ticketId,
        quote_available: false,
        price_needs_confirmation: true,
        cost_confirmed: false,
        // Matches the ticket event: no Shopify listing at all vs. listing without a confirmed cost.
        cost_status: part ? 'cost_unconfirmed' : 'no_listing',
        tier: TIERS[tier].label,
        device_model,
        repair_type,
        ...(part ? { part_found: true, part_available: part.availableForSale } : { part_found: false }),
        message: `We don't have a confirmed price for the ${device_model} ${repair_type.replace(/_/g, ' ')} right now. Do not give or guess any dollar amount. Tell the customer a technician will confirm the price and follow up, or they can call ${BUSINESS_PHONE_DISPLAY}.`,
      },
    }
  }

  const quote = calculateV4Quote({ tier, partCost: part.partCost, mobile: mobile_service })
  const ticket: Ticket = {
    id: ticketId,
    createdAt: now,
    updatedAt: now,
    status: 'quoted',
    tier,
    source,
    deviceModel: device_model,
    summary: repair_type,
    quote: { total: quote.total, repairPrice: quote.repairPrice, tripFee: quote.tripFee, costSource: part.costSource, costConfirmed: true },
    events: [{ at: now, type: 'quote', detail: { repairType: repair_type, total: quote.total, product: part.handle } }],
  }
  await store.create(ticket)

  return {
    status: 200,
    body: {
      success: true,
      ticket_id: ticketId,
      quote_available: true,
      tier: TIERS[tier].label,
      device_model,
      repair_type,
      currency: part.currency,
      repair_price: quote.repairPrice,
      mobile_trip_fee: quote.tripFee,
      total: quote.total,
      lines: quote.lines,
      tax_included: false,
      part_available: part.availableForSale,
      cost_confirmed: true,
      message:
        `Estimate for ${device_model}: $${quote.repairPrice} for the repair` +
        (quote.tripFee ? ` plus a $${quote.tripFee} mobile trip fee, $${quote.total} total` : '') +
        ', before sales tax. Final price is confirmed by the technician after inspection.',
    },
  }
}
