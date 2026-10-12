/**
 * Internal SMS alert for a thermal lockout (ported from rev5 thermalLockoutAlert.ts).
 * Sends only to THERMAL_LOCKOUT_ALERT_PHONE (an ops number), never a customer.
 */
import { normalizeUsPhone } from '../phone'
import { getTwilioConfig, sendTwilioSms } from '../twilio'
import { THERMAL_LOCKOUT_THRESHOLD_C } from './fault-triangulation'

export async function sendThermalLockoutAlert(
  params: { deviceId: string; thermalReading: number },
  ctx: { env?: Record<string, string | undefined>; fetchImpl?: typeof fetch } = {}
): Promise<{ sent: boolean; provider: 'twilio' | 'not-configured' }> {
  const env = ctx.env ?? process.env
  const twilio = getTwilioConfig(env)
  const to = normalizeUsPhone(env.THERMAL_LOCKOUT_ALERT_PHONE)
  if (!twilio || !to) return { sent: false, provider: 'not-configured' }
  const deviceId = params.deviceId.replace(/[^A-Za-z0-9 _.-]/g, '').slice(0, 64)
  const body = `D&CP THERMAL LOCKOUT: device ${deviceId} hit ${params.thermalReading}C (>= ${THERMAL_LOCKOUT_THRESHOLD_C}C). Cut power and verify on the bench now.`
  const result = await sendTwilioSms(twilio, to, body, ctx.fetchImpl ?? fetch)
  return { sent: result.sent, provider: 'twilio' }
}
