/** diagnose_hardware_telemetry tool: rev5 fault triangulation + thermal lockout alert. */
import { z } from 'zod'
import { isThermalLockoutTriggered, triangulateFaults } from '../diagnostics/fault-triangulation'
import { sendThermalLockoutAlert } from '../diagnostics/thermal-alert'
import { firstIssue, type ToolContext, type ToolResult } from './types'

export const TelemetrySchema = z.object({
  device_id: z.string().trim().min(1).max(64),
  v_term: z.number().finite().min(0).max(30),
  current_draw: z.number().finite().min(0).max(20),
  thermal_reading: z.number().finite().min(-40).max(200),
})

export async function telemetryTool(input: unknown, ctx: ToolContext = {}): Promise<ToolResult> {
  const parsed = TelemetrySchema.safeParse(input ?? {})
  if (!parsed.success) return { status: 400, body: { success: false, error: firstIssue(parsed.error, 'Invalid telemetry') } }
  const d = parsed.data
  const faults = triangulateFaults({ deviceId: d.device_id, vTerm: d.v_term, currentDraw: d.current_draw, thermalReading: d.thermal_reading })
  const lockout = isThermalLockoutTriggered(d.thermal_reading)
  const alert = lockout ? await sendThermalLockoutAlert({ deviceId: d.device_id, thermalReading: d.thermal_reading }, ctx) : null
  const boardFault = faults.some((f) => f.faultCode === 'VDD_MAIN_SHORT')
  return {
    status: 200,
    body: {
      success: true,
      thermal_lockout: lockout,
      alert_sent: alert?.sent ?? false,
      faults,
      recommended_tier: lockout || boardFault ? 'Tier 3' : faults.length ? 'Tier 1' : null,
      requires_escalation: lockout || boardFault,
    },
  }
}
