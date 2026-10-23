import { describe, expect, it } from 'vitest'
import { createMemoryStore } from '@/lib/store/memory'
import { recordWebIntake, smartTriageTool } from '@/lib/tools/smart-triage'
import { dispatchTool, resetSmsLimiters } from '@/lib/tools/dispatch'
import { SMS_CONSENT_TEXT } from '@/lib/config'

describe('web intake SMS consent (A2P 10DLC)', () => {
  it('triage works with no phone and no consent', async () => {
    const r = smartTriageTool({ symptoms: 'cracked screen' })
    expect(r.status).toBe(200)
    expect(await recordWebIntake({ symptoms: 'cracked screen' }, { store: createMemoryStore() })).toEqual({})
  })

  it('consent text is exact', () => {
    expect(SMS_CONSENT_TEXT).toBe(
      'Text me my booking link and repair updates from Display & Cell Pros. Msg & data rates may apply. Msg frequency varies. Reply STOP to opt out, HELP for help.',
    )
  })

  it('stores consent boolean + timestamp, defaulting to false', async () => {
    const store = createMemoryStore()
    const now = () => new Date('2026-10-23T13:00:00Z')
    const off = await recordWebIntake({ symptoms: 'cracked screen', customer_phone: '(509) 555-0123' }, { store, now })
    const on = await recordWebIntake({ symptoms: 'cracked screen', customer_phone: '509-555-0124', sms_consent: true }, { store, now })
    const tOff = await store.get(off.ticket_id!)
    const tOn = await store.get(on.ticket_id!)
    expect(tOff?.smsConsent).toMatchObject({ granted: false, at: '2026-10-23T13:00:00.000Z' })
    expect(tOn?.smsConsent).toMatchObject({ granted: true, at: '2026-10-23T13:00:00.000Z' })
  })

  it('dispatch never texts a ticket without consent', async () => {
    resetSmsLimiters()
    const store = createMemoryStore()
    const off = await recordWebIntake({ symptoms: 'cracked screen', customer_phone: '(509) 555-0123' }, { store })
    const r = await dispatchTool(
      { ticket_id: off.ticket_id, customer_name: 'A', customer_phone: '(509) 555-0123' },
      { store, env: { TWILIO_ACCOUNT_SID: 'x', TWILIO_AUTH_TOKEN: 'x', TWILIO_FROM_NUMBER: '+15095550000' }, fetchImpl: (() => { throw new Error('must not send') }) as unknown as typeof fetch },
    )
    expect(r.status).toBe(403)
    expect(r.body.smsSent).toBe(false)
  })
})
