/**
 * Public Smart Triage (web): symptoms -> tier + guidance. Deterministic, no
 * LLM, no ticket, no contact details collected. Ported from rev5 Smart
 * Triage (app/api/ai/smart-triage + triageKnowledgeBase), minus the LLM call.
 */
import { z } from 'zod'
import { BUSINESS_PHONE_DISPLAY, SERVICES_FAQ_URL } from '../config'
import { findMatchingDevices } from '../diagnostics/knowledge-base'
import { classifySymptoms } from '../tiers'
import { firstIssue, type ToolResult } from './types'

export const SmartTriageSchema = z.object({
  device_model: z.string().trim().max(120).optional().default(''),
  symptoms: z.string().trim().min(3, 'Describe what is happening').max(1000),
})

const DIY_STEPS = {
  TIER_1: ['Try a different cable and charger.', 'Gently check the charging port for lint or debris.', 'Restart the phone.'],
  TIER_2: ['Back up your phone if the screen still works.', 'Avoid pressing on cracked glass.'],
  TIER_3: ['Do not charge the phone if it got wet or feels hot.', 'Do not try to turn it on repeatedly.', 'Keep it powered off until a technician looks at it.'],
} as const

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
