/**
 * Public Smart Triage (web): symptoms -> tier + guidance. Deterministic, no
 * LLM, no ticket unless the customer leaves an optional phone number
 * (recordWebIntake), and never sends a text itself. Ported from rev5 Smart
 * Triage (app/api/ai/smart-triage + triageKnowledgeBase), minus the LLM call.
 */
import { z } from 'zod'
import { BUSINESS_PHONE_DISPLAY, SERVICES_FAQ_URL, SMS_CONSENT_TEXT } from '../config'
import { normalizeUsPhone } from '../phone'
import { getTicketStore, newTicketId, type Ticket, type TicketStore } from '../store'
import { findMatchingDevices } from '../diagnostics/knowledge-base'
import { classifySymptoms } from '../tiers'
import { firstIssue, type ToolResult } from './types'

export const SmartTriageSchema = z.object({
  device_model: z.string().trim().max(120).optional().default(''),
  symptoms: z.string().trim().min(3, 'Describe what is happening').max(1000),
  /** Optional contact number. Texting is never required. */
  customer_phone: z.string().trim().max(32).optional().default(''),
  /** Optional SMS opt-in checkbox; unchecked (false) by default. */
  sms_consent: z.boolean().optional().default(false),
})

const DIY_STEPS = {
  TIER_1: ['Try a different cable and charger.', 'Gently check the charging port for lint or debris.', 'Restart the phone.'],
  TIER_2: ['Back up your phone if the screen still works.', 'Avoid pressing on cracked glass.'],
  TIER_3: ['Do not charge the phone if it got wet or feels hot.', 'Do not try to turn it on repeatedly.', 'Keep it powered off until a technician looks at it.'],
} as const

/**
 * Saves a web intake ticket when the customer left a phone number, with their
 * SMS consent (boolean + timestamp). Best effort: triage still answers if the
 * store is down. Nothing here sends a text.
 */
export async function recordWebIntake(
  input: unknown,
  ctx: { store?: TicketStore | null; env?: Record<string, string | undefined>; now?: () => Date } = {},
): Promise<{ ticket_id?: string; sms_consent?: boolean; phone_error?: string }> {
  const parsed = SmartTriageSchema.safeParse(input ?? {})
  if (!parsed.success || !parsed.data.customer_phone) return {}
  const phone = normalizeUsPhone(parsed.data.customer_phone)
  if (!phone) return { phone_error: 'That phone number does not look like a US number, so it was not saved.' }
  const store = ctx.store !== undefined ? ctx.store : getTicketStore(ctx.env ?? process.env)
  if (!store) return {}
  const c = classifySymptoms(parsed.data.symptoms)
  const at = (ctx.now?.() ?? new Date()).toISOString()
  const granted = parsed.data.sms_consent === true
  const ticket: Ticket = {
    id: newTicketId(c.tier === 'TIER_1' ? 'T1' : c.tier === 'TIER_2' ? 'T2' : 'T3'),
    createdAt: at,
    updatedAt: at,
    status: 'new',
    tier: c.tier,
    source: 'web',
    deviceModel: parsed.data.device_model,
    summary: parsed.data.symptoms,
    customer: { phone },
    smsConsent: { granted, at, source: 'web_form', text: SMS_CONSENT_TEXT },
    events: [{ at, type: 'created', detail: { channel: 'web_form', smsConsent: granted } }],
  }
  try {
    await store.create(ticket)
    return { ticket_id: ticket.id, sms_consent: granted }
  } catch (err) {
    console.error('[dcp-triage] web intake ticket not saved:', err instanceof Error ? err.message : 'unknown error')
    return {}
  }
}

export function smartTriageTool(input: unknown): ToolResult {
  const parsed = SmartTriageSchema.safeParse(input ?? {})
  if (!parsed.success) return { status: 400, body: { success: false, error: firstIssue(parsed.error, 'Invalid request') } }
  const { device_model, symptoms } = parsed.data
  const c = classifySymptoms(symptoms)
  // When the customer names a model in the text and no model was selected, prefer that model.
  const model = device_model || symptoms
  const related = findMatchingDevices(model, symptoms, 2)
    .filter((m) => m.matchedSymptoms.length > 0)
    .map((m) => ({ device: `${m.device.manufacturer} ${m.device.modelName}`, knownIssues: m.matchedSymptoms.slice(0, 3) }))

  return {
    status: 200,
    body: {
      success: true,
      tier: c.label,
      tier_id: c.tier,
      tier_name: c.name,
      confidence: c.confidence,
      requires_escalation: c.requiresEscalation,
      diy_steps: DIY_STEPS[c.tier],
      related_known_issues: related,
      next_step: c.requiresEscalation
        ? `This sounds like a ${c.label} repair, which needs a technician to look at it before we can price it. Call ${BUSINESS_PHONE_DISPLAY}.`
        : `This sounds like a ${c.label} (${c.name.toLowerCase()}) repair. Call ${BUSINESS_PHONE_DISPLAY} for an estimate.`,
      info_url: SERVICES_FAQ_URL,
    },
  }
}
