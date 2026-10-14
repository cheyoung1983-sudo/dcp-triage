/**
 * validate_wa_r2r_compliance tool.
 * portalRev2 only named this tool in a header comment; it had no
 * implementation. This is a conservative checklist so the agent discloses
 * part provenance and gets consent before work starts. It is not legal
 * advice and should be reviewed by Ryan before relying on it.
 */
import { z } from 'zod'
import { firstIssue, type ToolResult } from './types'

export const PART_PROVENANCE = ['oem_new', 'oem_refurbished', 'aftermarket', 'used'] as const

export const ComplianceSchema = z.object({
  part_provenance: z.enum(PART_PROVENANCE),
  customer_informed_of_provenance: z.boolean(),
  customer_consented: z.boolean(),
})

const PROVENANCE_TEXT: Record<(typeof PART_PROVENANCE)[number], string> = {
  oem_new: 'a new original-manufacturer part',
  oem_refurbished: 'a refurbished original-manufacturer part',
  aftermarket: 'an aftermarket (non-original) part',
  used: 'a used part',
}

export function complianceTool(input: unknown): ToolResult {
  const parsed = ComplianceSchema.safeParse(input ?? {})
  if (!parsed.success) return { status: 400, body: { success: false, error: firstIssue(parsed.error, 'Invalid request') } }
  const d = parsed.data
  const missing: string[] = []
  if (!d.customer_informed_of_provenance) missing.push('Tell the customer the repair uses ' + PROVENANCE_TEXT[d.part_provenance] + '.')
  if (!d.customer_consented) missing.push('Get the customer to agree before any work starts.')
  return {
    status: 200,
    body: {
      success: true,
      compliant: missing.length === 0,
      disclosure: `This repair uses ${PROVENANCE_TEXT[d.part_provenance]}.`,
      missing_steps: missing,
      note: 'Checklist only, not legal advice.',
    },
  }
}
