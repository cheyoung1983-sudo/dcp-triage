/** Minimal Twilio REST client (no SDK), ported from rev5/PR #45. */
export interface TwilioConfig {
  accountSid: string
  authToken: string
  fromNumber: string
}

export function getTwilioConfig(env: Record<string, string | undefined> = process.env): TwilioConfig | null {
  const accountSid = (env.TWILIO_ACCOUNT_SID || '').trim()
  const authToken = (env.TWILIO_AUTH_TOKEN || '').trim()
  const fromNumber = (env.TWILIO_FROM_NUMBER || '').trim()
  if (!accountSid || !authToken || !fromNumber) return null
  return { accountSid, authToken, fromNumber }
}

export async function sendTwilioSms(
  config: TwilioConfig,
  to: string,
  body: string,
  fetchImpl: typeof fetch = fetch
): Promise<{ sent: boolean; status?: number }> {
  try {
    const res = await fetchImpl(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(config.accountSid)}/Messages.json`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${config.accountSid}:${config.authToken}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ To: to, From: config.fromNumber, Body: body }),
        signal: AbortSignal.timeout(10_000),
      }
    )
    return { sent: res.ok, status: res.status }
  } catch {
    return { sent: false }
  }
}
