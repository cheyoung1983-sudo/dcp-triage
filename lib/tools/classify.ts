import { z } from 'zod'
import { classifySymptoms } from '../tiers'
import { firstIssue, type ToolResult } from './types'

export const ClassifySchema = z.object({
  device_model: z.string().trim().max(120).optional().default(''),
  symptoms: z.string().trim().min(1).max(2000),
})

/** classify_repair_tier tool: free-text symptoms -> one of the three tiers. */
export function classifyTool(input: unknown): ToolResult {
  const parsed = ClassifySchema.safeParse(input ?? {})
  if (!parsed.success) return { status: 400, body: { success: false, error: firstIssue(parsed.error, 'Invalid request') } }
  const c = classifySymptoms(parsed.data.symptoms)
  return {
    status: 200,
    body: {
      success: true,
      tier: c.label,
      tier_id: c.tier,
      tier_name: c.name,
      quotable: c.quotable,
      requires_escalation: c.requiresEscalation,
      confidence: c.confidence,
      matched_signals: c.matchedSignals,
      next_step: c.requiresEscalation
        ? 'Do not quote a price. Collect name, phone and symptoms, then call escalate_tier3_ticket.'
        : 'Confirm the repair type with the customer, then call get_repair_quote.',
    },
  }
}
