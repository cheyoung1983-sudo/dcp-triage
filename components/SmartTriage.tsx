'use client'

/**
 * Customer-facing Smart Triage (adapted from rev5 SmartTriageChat.tsx and
 * triageOfflineStore.ts). Calls /api/smart-triage; if the network is down it
 * falls back to the same tier classifier bundled in the page, and caches
 * recent results in localStorage.
 */
import { useState, type FormEvent } from 'react'
import { BUSINESS_PHONE_DISPLAY, PRIVACY_POLICY_URL, SMS_CONSENT_TEXT, SMS_TERMS_URL } from '@/lib/config'
import { classifySymptoms } from '@/lib/tiers'
import { smartTriageErrorMessage } from '@/lib/triage-errors'

interface Result {
  tier: string
  tier_name: string
  requires_escalation: boolean
  next_step: string
  diy_steps: readonly string[]
  related_known_issues?: { device: string; knownIssues: string[] }[]
  offline?: boolean
}

const CACHE_KEY = 'dcp-triage-cache-v1'

function readCache(): Record<string, Result> {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}') as Record<string, Result>
  } catch {
    return {}
  }
}

function writeCache(key: string, value: Result) {
  try {
    const cache = readCache()
    cache[key] = value
    const keys = Object.keys(cache)
    while (keys.length > 20) delete cache[keys.shift() as string]
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache))
  } catch {
    // Storage full or disabled: caching is optional.
  }
}

function offlineResult(symptoms: string): Result {
  const c = classifySymptoms(symptoms)
  return {
    tier: c.label,
    tier_name: c.name,
    requires_escalation: c.requiresEscalation,
    next_step: `You appear to be offline. This looks like a ${c.label} repair. Call ${BUSINESS_PHONE_DISPLAY} when you can.`,
    diy_steps: [],
    offline: true,
  }
}

export default function SmartTriage() {
  const [deviceModel, setDeviceModel] = useState('')
  const [symptoms, setSymptoms] = useState('')
  const [phone, setPhone] = useState('')
  const [smsConsent, setSmsConsent] = useState(false)
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<Result | null>(null)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setNotice('')
    // Clear the previous answer so an error is never shown next to a stale result.
    setResult(null)
    if (symptoms.trim().length < 3) {
      setError('Tell us what is happening with the phone.')
      return
    }
    const key = `${deviceModel.trim().toLowerCase()}|${symptoms.trim().toLowerCase()}`
    setLoading(true)
    try {
      const res = await fetch('/api/smart-triage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device_model: deviceModel, symptoms, customer_phone: phone, sms_consent: smsConsent }),
      })
      // A non-JSON reply (e.g. a platform error page) must not surface a raw parser error.
      const json = (await res.json().catch(() => null)) as (Result & { success?: boolean; error?: string; ticket_id?: string; phone_error?: string }) | null
      if (!res.ok || !json?.success) {
        setError(smartTriageErrorMessage(res.status, json?.error))
        return
      }
      setResult(json)
      if (json.phone_error) setNotice(json.phone_error)
      else if (json.ticket_id) setNotice(`Saved. Your reference is ${json.ticket_id}.`)
      writeCache(key, json)
    } catch {
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        setResult(readCache()[key] ?? offlineResult(symptoms))
      } else {
        setError(smartTriageErrorMessage(0))
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="card">
      <form onSubmit={onSubmit}>
        <label htmlFor="device">Phone model (optional)</label>
        <input id="device" value={deviceModel} onChange={(e) => setDeviceModel(e.target.value)} placeholder="e.g. iPhone 13" maxLength={120} />
        <label htmlFor="symptoms">What is happening?</label>
        <textarea id="symptoms" rows={4} value={symptoms} onChange={(e) => setSymptoms(e.target.value)} placeholder="e.g. Screen is cracked and touch stopped working" maxLength={1000} />
        <label htmlFor="phone">Mobile number (optional)</label>
        <input id="phone" type="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="e.g. (509) 555-0123" maxLength={32} />
        <label className="consent" htmlFor="sms-consent">
          <input id="sms-consent" name="sms_consent" type="checkbox" checked={smsConsent} onChange={(e) => setSmsConsent(e.target.checked)} />
          <span>
            {SMS_CONSENT_TEXT} <a href={SMS_TERMS_URL}>SMS Terms</a> · <a href={PRIVACY_POLICY_URL}>Privacy Policy</a>
          </span>
        </label>
        <p className="muted">Texting is optional and not required to get a diagnosis.</p>
        <button type="submit" disabled={loading}>{loading ? 'Checking…' : 'Get a diagnosis'}</button>
      </form>
      {error && <p role="alert">{error}</p>}
      {notice && <p className="muted" aria-live="polite">{notice}</p>}
      {result && (
        <section aria-live="polite">
          <h2>
            <span className="tier">{result.tier}</span> {result.tier_name}
          </h2>
          <p>{result.next_step}</p>
          {result.diy_steps.length > 0 && (
            <>
              <h3>While you wait</h3>
              <ul>{result.diy_steps.map((s) => <li key={s}>{s}</li>)}</ul>
            </>
          )}
          {!!result.related_known_issues?.length && (
            <p className="muted">
              Similar known issues: {result.related_known_issues.map((r) => `${r.device} (${r.knownIssues.join('; ')})`).join(', ')}
            </p>
          )}
          <p className="muted">This is a preliminary assessment, not a quote. A technician confirms the diagnosis and price.</p>
        </section>
      )}
    </div>
  )
}
