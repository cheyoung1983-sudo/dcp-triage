/**
 * check_part_inventory tool (from portalRev2 triageAgentEngine.ts).
 * portalRev2 used a hard-coded catalog with made-up stock counts and bin
 * locations; this version asks Shopify (read-only) whether a matching part
 * product exists and is available for sale. It never reports a quantity.
 */
import { z } from 'zod'
import { searchPartProducts } from '../shopify'
import { firstIssue, type ToolContext, type ToolResult } from './types'

export const InventorySchema = z.object({
  device_model: z.string().trim().min(1).max(120),
  part: z.string().trim().min(1).max(80),
})

export async function inventoryTool(input: unknown, ctx: ToolContext = {}): Promise<ToolResult> {
  const parsed = InventorySchema.safeParse(input ?? {})
  if (!parsed.success) return { status: 400, body: { success: false, error: firstIssue(parsed.error, 'Invalid request') } }
  const results = await searchPartProducts(parsed.data.device_model, parsed.data.part, { env: ctx.env, fetchImpl: ctx.fetchImpl })
  if (results === null) {
    return {
      status: 200,
      body: { success: true, inventory_known: false, message: 'Part availability needs confirmation by a technician.' },
    }
  }
  return {
    status: 200,
    body: {
      success: true,
      inventory_known: true,
      matches: results.map((r) => ({ title: r.productTitle, handle: r.handle, available: r.availableForSale })),
      any_available: results.some((r) => r.availableForSale),
    },
  }
}
