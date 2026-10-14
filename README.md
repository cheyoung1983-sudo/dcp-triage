# dcp-triage

Standalone repair-triage app for Display & Cell Pros, deployed separately
from the Shopify storefront at `triage.displaycellpros.com` so the
storefront and catalog can't be affected.

- Next.js 16 (App Router), TypeScript, Node 24, Vercel-ready
- Public web page: describe the problem, get a tier and next steps
- Authenticated tool API for the ElevenLabs voice agent: classify, quote, text the estimate, escalate Tier 3
- Read-only Shopify part prices, persistent tickets in Upstash Redis

## Architecture

```
app/
  page.tsx                       public "Get a diagnosis" page (SmartTriage + GuidedTriage)
  api/health                     public liveness
  api/smart-triage               public, deterministic, rate-limited, no PII, no tickets
  api/tools/*  api/pricing/quote  api/intake/*  api/tickets/*   agent-only (X-DCP-Agent-Secret)
lib/
  tiers.ts          the ONE tier system + symptom classifier
  pricing.ts        the ONE pricing engine (V4)
  shopify.ts        read-only Admin API part search, availability, listed price + cost
  shopify-admin.ts  client-credentials token cache + read-only Admin GraphQL
  store/            ticket store: Upstash Redis (prod/preview), in-memory (dev/test only)
  auth.ts           constant-time X-DCP-Agent-Secret check, fail closed
  tools/*           one module per tool (pure functions with injectable fetch/store/env)
  diagnostics/*     decision tree, knowledge base, fault triangulation, thermal alert
components/         SmartTriage (with offline fallback + local cache), GuidedTriage
```

### Tiers

| Tier | Covers | Quotable |
|---|---|---|
| Tier 1 | power / port: battery, charging port | yes |
| Tier 2 | display: screen (aftermarket/OEM), camera, back glass | yes |
| Tier 3 | logic board, liquid/water damage, no power, data recovery, anything unclear | **never**: escalates to Ryan |

### Pricing (V4)

`repair price = ceil(part cost × 1.8 + $75 labor)` in whole dollars, plus a
separate **$25 mobile trip fee** line for mobile service. Sales tax is not
included. Everything comes from one read-only Shopify **Admin API** query
(server-side only; no Storefront token): product search (`status:active`),
availability (ACTIVE + published to the Online Store + first variant
`availableForSale` or inventory policy CONTINUE; quantities are never
requested), the listed price, and the wholesale cost in the `dcp.part_cost`
product metafield. Auth is a separate Admin app with only `read_products`,
via the client credentials grant (token cached in memory, refreshed before
expiry, retried once on 401; same pattern as the storefront's
`services/shopify-admin.ts`). If the metafield is missing, the listed price
is used and the quote is marked `cost_confirmed: false` /
`cost_status: "cost_unconfirmed"`. Cost values are never returned by any
endpoint, stored on tickets, or logged. If the Admin app isn't configured,
fails, or nothing matches, the quote says *price needs confirmation* and
gives no number. The old `$50/hr + 80%` and rev5
`$55/hr + 95%` formulas are gone.

### Flow

1. `classify` → tier. 2. `quote` → saves a ticket (`DCP-T1-…`/`DCP-T2-…`).
3. `dispatch-sms` texts the price **stored on the ticket** (the agent can't
supply a price); refuses Tier 3 and unpriced tickets. 4. `escalate-tier3`
saves/reclassifies the ticket as Tier 3 (voiding any estimate) and posts a
Slack alert **without** phone or email.

## Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | /api/health | public | liveness |
| POST | /api/smart-triage | public (rate-limited) | tier + guidance for the web page |
| POST | /api/tools/classify | agent | symptoms → tier |
| POST | /api/pricing/quote | agent | V4 quote, refuses Tier 3 |
| POST | /api/intake/dispatch-sms | agent | text the estimate via Twilio |
| POST | /api/intake/escalate-tier3 | agent | ticket + Slack alert |
| POST | /api/tools/check-part-inventory | agent | Shopify availability (no quantities) |
| POST | /api/tools/validate-wa-r2r-compliance | agent | part-provenance disclosure checklist |
| POST | /api/tools/diagnose-telemetry | agent | bench fault triangulation + thermal alert |
| GET | /api/tickets?limit= | agent | recent tickets |
| GET | /api/tickets/:id | agent | one ticket |

Agent endpoints: `X-DCP-Agent-Secret` compared in constant time to
`ELEVENLABS_WEBHOOK_SECRET`. 503 if unset (every environment), 401 if wrong,
405 for wrong method. Tool and agent setup: [docs/elevenlabs-agent.md](docs/elevenlabs-agent.md).

## Environment variables

| Name | Secret? | Required | Notes |
|---|---|---|---|
| ELEVENLABS_WEBHOOK_SECRET | secret | yes | agent auth; unset → 503 |
| UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN | URL not secret / token secret | yes (one pair) | ticket store |
| KV_REST_API_URL / KV_REST_API_TOKEN | same | alternative pair | set by Vercel's Upstash integration |
| SHOPIFY_STORE_DOMAIN | public | for prices | the store's permanent `*.myshopify.com` domain (`7r1d6z-cc.myshopify.com`), not an alias |
| SHOPIFY_CLIENT_ID | secret | for prices | Admin app (read_products only), client credentials grant |
| SHOPIFY_CLIENT_SECRET | secret | for prices | same Admin app; store only on dcp-triage |
| SHOPIFY_ADMIN_API_VERSION | public | optional | default `2026-01` |
| TWILIO_ACCOUNT_SID | secret | for SMS | |
| TWILIO_AUTH_TOKEN | secret | for SMS | |
| TWILIO_FROM_NUMBER | public | for SMS | E.164 |
| SLACK_ESCALATION_WEBHOOK_URL | secret | for Tier 3 | https only |
| THERMAL_LOCKOUT_ALERT_PHONE | private (not secret) | optional | ops number for bench alerts |

Without the ticket store on Vercel (preview or production), quote, SMS and
escalation return 503. Tickets never live in memory outside local dev/tests.

## Development

```
nvm use            # Node 24
npm ci
cp .env.example .env.local   # fill in what you need
npm run dev
npm run check      # lint + typecheck + tests + build (same as CI)
```

## Business facts

Only the public phone (509) 255-3852 and the services FAQ URL are used. No
business hours or street address are hard-coded. If calls are recorded, the
agent must announce it (Washington all-party consent).

## Provenance

Ported from www.displaycellpros.comrev5, dcptriage, portalRev2 and
builderio-shopify-commerce-headless PR #45. See the PR description for the
file-by-file mapping.
