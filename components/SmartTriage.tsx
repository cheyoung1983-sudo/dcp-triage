'use client'

/**
 * Customer-facing Smart Triage (adapted from rev5 SmartTriageChat.tsx and
 * triageOfflineStore.ts). Calls /api/smart-triage; if the network is down it
 * falls back to the same tier classifier bundled in the page, and caches
 * recent results in localStorage.
 */
import { useState, type FormEvent } from 'react'
import { BUSINESS_PHONE_DISPLAY } from '@/lib/config'
import { classifySymptoms } from '@/lib/tiers'

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
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<Result | null>(null)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
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
        body: JSON.stringify({ device_model: deviceModel, symptoms }),
      })
      const json = await res.json()
      if (!res.ok || !json.success) throw new Error(json.error || 'Something went wrong')
      setResult(json)
      writeCache(key, json)
    } catch (err) {
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        setResult(readCache()[key] ?? offlineResult(symptoms))
      } else {
        setError(err instanceof Error ? err.message : 'Something went wrong')
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
        <button type="submit" disabled={loading}>{loading ? 'Checking…' : 'Get a diagnosis'}</button>
      </form>
      {error && <p role="alert">{error}</p>}
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
