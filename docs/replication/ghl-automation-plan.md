# GHL Automation Plan — index

This document is the entry point for the GHL automation system. The detailed truth lives in three places:

| Concern | Document | Status |
|---|---|---|
| **What state should GHL be in?** | [`config/ghl-schema.ts`](../../config/ghl-schema.ts) | Locked |
| **How does the website talk to GHL?** | [`docs/replication/ghl-api-integration-spec.md`](./ghl-api-integration-spec.md) | Build-ready |
| **How do I onboard a new client?** | [`docs/replication/ghl-onboarding-runbook.md`](./ghl-onboarding-runbook.md) | Build-ready |

If those three are inconsistent, **the schema wins** — it's the source of truth.

---

## 1. What this system does

Automates the lead lifecycle for a Brazilian Jiu-Jitsu academy:

```
Opt-in ──► Lead Nurture ──► Book trial ──► Attend ──► Convert to member
                                       └─► No-show ──► Rebook campaign ──► …
```

Three GHL pipelines (parent contact level + trainee level), 12+ campaign workflows, and a website-side API layer that orchestrates GHL via REST.

---

## 2. Locked architectural decisions

These are the calls that shape the rest of the system. Made during the multi-agent audit + research phase on 2026-05-07.

| # | Decision | Why |
|---|---|---|
| 1 | **Flat webhook payloads** to GHL (snake_case, no nesting) | GHL inbound webhooks don't reliably resolve dot-notation; arrays can't be referenced in workflow custom values |
| 2 | **Credits live on the Contact**, mirrored to opp for display | GHL Math Operation only writes to Contact custom fields |
| 3 | **`trainee_key` slug** (deterministic, generated at the website) | Rebook detection + sibling disambiguation; GHL can't filter opps by custom field server-side |
| 4 | **Rebook detection in `/api/book`** (website-side) | Same — query GHL `/opportunities/search`, filter by `trainee_key` client-side, set `is_rebook` flag in payload |
| 5 | **Single source of truth for WON closure** = Trial Credit Monitoring pipeline | Avoids duplicate close events when admin moves Trial Conversion → ENROLLED directly |
| 6 | **Pre-trial reminders use native Calendar Appointment trigger** | Trials are real GHL appointments (created by `/api/book`); calendar-relative waits work natively |
| 7 | **Trial Credit Monitoring LOST → Lead Acquisition NURTURE CAMPAIGN** | They've been through trial; "last chance" cold-lead drip is the right re-engagement |
| 8 | **Walk-ins use the public booking flow** | Avoids a separate code path; revisit if volume justifies |
| 9 | **Default credits = 3**, stored as GHL Custom Value `trial_credits_default` | Admin can change without redeploy |
| 10 | **Reproducibility-as-code** via `config/ghl-schema.ts` | Onboarding a new client = schema-driven UI checklist + ID discovery, not bespoke setup |

---

## 3. Pipeline summary

For full stage transitions and action lists, see [`config/ghl-schema.ts`](../../config/ghl-schema.ts) → `STAGE_TRANSITIONS`.

### 3.1 Lead Acquisition (parent contact)
`NEW LEAD` → 24h timer → `TRIAL NURTURE` → 7d → `NURTURE CAMPAIGN` → 14d → `LOST / COLD`

Any booking moves opp to `INTRO BOOKED (WON)` (terminal).
On `LOST / COLD` entry: `quarterly-reactivation` tag added.

### 3.2 Trial Conversion (per booked trial, disambiguated by `trainee_key`)
`INTRO BOOKED` → auto-move at appointment end → `TRIAL APPOINTMENT DONE`
→ admin classifies → `NO-SHOW` | `TRIAL ACTIVE NURTURE` | `STUDENT ENROLLED (WON)`

`NO-SHOW` → 5min delay → `INTRO CLASS REBOOKING` → 14d → `TRIAL INACTIVE REACTIVATION` → 21d → `LOST / COLD`
`TRIAL ACTIVE NURTURE` entry: creates Credit Monitoring opp at `CREDIT ACTIVE`, sets credits to default.
`LOST / COLD` entry: pushes Lead Acquisition opp back to `NURTURE CAMPAIGN`.

### 3.3 Trial Credit Monitoring (per active trial pass, disambiguated by `trainee_key`)
`CREDIT ACTIVE` → 14d idle timer → `REACTIVATION` → 21d → `LOST`
On rebook: `→ ANOTHER TRIAL BOOKED` → auto-move morning of appointment → `APPOINTMENT TODAY`
→ admin classifies → `ATTENDED APPOINTMENT` (decrement; → `CREDIT ACTIVE` or `CREDITS EXHAUSTED`) | `NO-SHOW` (no decrement; back to `CREDIT ACTIVE`)
`LOST` entry: zero credits, push Lead Acquisition opp to `NURTURE CAMPAIGN`.

---

## 4. Build phases

| Phase | Scope | Status |
|---|---|---|
| 0 | Reproducibility tooling: schema, runbook, onboard CLI, `.env.example` | **DONE** ✅ |
| 1 | Foundations: rate-limit wrapper, pipeline + custom-field caches, types, health endpoint | Next |
| 2 | `/api/lead` endpoint + Lead Acquisition pipeline live | After 1 |
| 3 | Booking + rebook detection + Trial Conversion pipeline live | After 2 |
| 4 | Inbound webhooks + Trial Credit Monitoring + cancellation | After 3 |
| 5 | `/rebook` page (active-trial students) | Scaffolded; finalize after 4 |
| 6 | Hardening (Upstash idempotency, log adapter, drift cron) | Optional, post-launch |

Full per-phase scope, files touched, and test plans: see the integration spec.

---

## 5. Reproducibility statement

Adding a new client to this system requires:

1. Clone repo, deploy to Vercel
2. Generate GHL PIT, populate 2 env vars
3. Run `npm run onboard:ghl checklist` — get the manual UI work as a printed checklist
4. ~60 minutes of GHL UI clicking from the checklist
5. Run `npm run onboard:ghl provision` (creates Custom Values + base tags via API)
6. Run `npm run onboard:ghl discover` (resolves names → IDs, writes `.env.client.local`)
7. Copy IDs into Vercel env, redeploy
8. Smoke-test via `/api/health/ghl`

Total target: <2 hours per client. **No code changes** — schema edits only when expanding the funnel.

If you find yourself patching client-specific behavior in handler code, that's a schema gap. Lift it into `config/ghl-schema.ts` and every client benefits on next deploy.
