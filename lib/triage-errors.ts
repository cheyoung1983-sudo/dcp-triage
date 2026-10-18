import { BUSINESS_PHONE_DISPLAY } from './config'

/** Customer-facing message for a failed /api/smart-triage call (never a raw parser or server error). */
export function smartTriageErrorMessage(status: number, serverError?: unknown): string {
  if (status === 429) return `Too many tries in a short time. Please wait a few minutes, or call ${BUSINESS_PHONE_DISPLAY}.`
  if (status === 413) return 'That description is too long. Please shorten it and try again.'
  if (status === 400 && typeof serverError === 'string' && serverError) return serverError
  return `Something went wrong. Please try again, or call ${BUSINESS_PHONE_DISPLAY}.`
}
