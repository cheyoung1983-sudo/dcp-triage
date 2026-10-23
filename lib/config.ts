/**
 * Public business constants. Only facts Ryan has published are here:
 * the phone number and the services FAQ URL. Do not add business hours
 * or a street address unless Ryan provides them.
 */
export const BUSINESS_NAME = 'Display & Cell Pros'
export const BUSINESS_PHONE_DISPLAY = '(509) 255-3852'
export const BUSINESS_PHONE_E164 = '+15092553852'
export const SMS_TERMS_URL = 'https://www.displaycellpros.com/sms-terms'
export const PRIVACY_POLICY_URL = 'https://www.displaycellpros.com/policies/privacy-policy'
/** Exact SMS opt-in wording reviewed for the Twilio A2P 10DLC campaign. Do not edit without re-registering. */
export const SMS_CONSENT_TEXT =
  'Text me my booking link and repair updates from Display & Cell Pros. Msg & data rates may apply. Msg frequency varies. Reply STOP to opt out, HELP for help.'
export const SERVICES_FAQ_URL = 'https://www.displaycellpros.com/services-faq'

/**
 * Washington is a two-party (all-party) consent state (RCW 9.73.030).
 * If a call is recorded, the voice agent must say this at the start.
 */
export const CALL_RECORDING_DISCLOSURE =
  'This call may be recorded and transcribed so we can help with your repair. If you do not want that, let me know or call us at (509) 255-3852.'

/** True only for local `next dev` / test runs. Used for in-memory fallbacks, never for auth. */
export function isLocalDevOrTest(env: Record<string, string | undefined> = process.env): boolean {
  if (env.VERCEL_ENV) return false
  return env.NODE_ENV === 'development' || env.NODE_ENV === 'test'
}
