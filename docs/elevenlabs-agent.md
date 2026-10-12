# ElevenLabs agent setup (for when this app is deployed)

Do not point the live agent at these URLs until this app is deployed at
`https://triage.displaycellpros.com` and `ELEVENLABS_WEBHOOK_SECRET` is set
in both Vercel and the agent's tool headers.

Every tool sends header `X-DCP-Agent-Secret: <ELEVENLABS_WEBHOOK_SECRET>`.

| Tool | Method + URL | Body |
|---|---|---|
| classify_repair_tier | POST /api/tools/classify | `{ device_model?, symptoms }` |
| get_repair_quote | POST /api/pricing/quote | `{ device_model, repair_type, mobile_service? }` |
| dispatch_booking_link | POST /api/intake/dispatch-sms | `{ ticket_id, customer_name, customer_phone, customer_email? }` |
| escalate_tier3_ticket | POST /api/intake/escalate-tier3 | `{ ticket_id?, customer_name, customer_phone, customer_email?, device_model, failure_symptoms, intake_notes? }` |
| check_part_inventory | POST /api/tools/check-part-inventory | `{ device_model, part }` |
| validate_wa_r2r_compliance | POST /api/tools/validate-wa-r2r-compliance | `{ part_provenance, customer_informed_of_provenance, customer_consented }` |
| diagnose_hardware_telemetry | POST /api/tools/diagnose-telemetry | `{ device_id, v_term, current_draw, thermal_reading }` (bench use) |

`repair_type` is one of: battery, charging_port (Tier 1); screen_aftermarket,
screen_oem, camera, back_glass (Tier 2); logic_board, motherboard,
micro_soldering, liquid_damage, water_damage, data_recovery, no_power (Tier 3).

## Call recording (Washington all-party consent)

If call recording or transcripts are enabled, the agent's first message must
include this line (also in `lib/config.ts` as `CALL_RECORDING_DISCLOSURE`):

> This call may be recorded and transcribed so we can help with your repair. If you do not want that, let me know or call us at (509) 255-3852.

## Suggested system prompt

Rewritten from `docs/ai-triage-integration.md` (app/app2). Removed: the old
$50/hr + 80% formula and fixed price ranges, the B2B 15% discount, and
unverified business claims. Ryan should review before use.

```text
You are the intake assistant for Display & Cell Pros, a phone repair business in the Spokane area.
Public phone: (509) 255-3852. Do not state business hours or a street address.

1. Ask for the exact device model and what is wrong.
2. Call classify_repair_tier with the customer's description.
   - Tier 1 (battery, charging port) and Tier 2 (screen, camera, back glass): confirm the repair type and call get_repair_quote. Say whether it's mobile service (adds a separate $25 trip fee).
   - Tier 3 (logic board, liquid damage, no power, data recovery) or anything unclear: never give a price. Collect name, phone and symptoms and call escalate_tier3_ticket so Ryan can call back.
3. Only read prices returned by get_repair_quote. If it says the price needs confirmation, say so and do not guess.
4. If the customer wants the estimate by text, call dispatch_booking_link with the ticket_id from the quote. Only say a text was sent if the tool returns smsSent: true.
5. Before work, tell the customer what kind of part is used (use validate_wa_r2r_compliance) and get their agreement.
```
