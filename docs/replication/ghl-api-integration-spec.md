# GHL API Integration Spec — Build Phases

**Status:** build-ready
**Last updated:** 2026-05-08
**Goal:** Reproducible GHL automation system for the Gracie Barra Whittier website. Every artifact is defined declaratively in [`config/ghl-schema.ts`](../../config/ghl-schema.ts) so onboarding the next client = clone repo + run script + click through GHL UI checklist.

> **Reproducibility contract:** No pipeline IDs, stage names, workflow IDs, or custom-field IDs are hardcoded in handler code. Everything resolves through the schema at runtime. Adding a new client should never require editing source code — only env vars and GHL UI clicks.

---

## 1. Architecture overview

The website is the integration plane. Browser-originated writes (opt-ins, bookings, cancellations) hit Astro `/api/*` endpoints which run a domain orchestrator (`ghl-adapter.ts`) that flattens payloads, performs idempotency + rebook checks, and issues authoritative GHL REST calls. Backflow from GHL (admin moves, automation outcomes) arrives via Workflow webhooks at `/api/webhooks/ghl/*`, gated by a shared `X-GBW-Secret` header and dispatched by stage name resolved through the schema.

```
┌──────────────────┐      ┌──────────────────────────────────────────┐      ┌─────────────────┐
│  Browser         │      │  Astro on Vercel (Node Fluid Compute)    │      │  GHL            │
│  ──────────────  │      │  ─────────────────────────────────────   │      │                 │
│  OptInForm       │ ───► │  POST /api/lead                          │      │ services        │
│  ContactForm     │      │  POST /api/book                          │ ───► │ .leadconnector  │
│  KickstartFlow   │      │  GET  /api/availability                  │      │ hq.com          │
│  RebookFlow      │      │  POST /api/cancel                        │      │ (REST API)      │
│                  │      │  POST /api/rebook-lookup                 │      │                 │
│                  │      │  GET  /api/health/ghl                    │      │                 │
│                  │      │       │                                  │      │                 │
│                  │      │       ▼                                  │      │                 │
│                  │      │  ghl-adapter.ts                          │      │                 │
│                  │      │       ▲                                  │      │                 │
│                  │      │  ─── reads ghl-schema.ts ─────           │      │                 │
│                  │      │                                          │      │                 │
│                  │      │  POST /api/webhooks/ghl/*  ◄─────────────┼──────│ Workflow        │
│                  │      │       (X-GBW-Secret)                     │      │ webhooks        │
└──────────────────┘      └──────────────────────────────────────────┘      └─────────────────┘
```

### What's in the schema (`config/ghl-schema.ts`)

| Asset | Source of truth | Created by |
|---|---|---|
| Pipelines + stages | `PIPELINES` const | UI (manual, per checklist) |
| Custom Fields | `CONTACT_CUSTOM_FIELDS`, `OPPORTUNITY_CUSTOM_FIELDS` | UI (manual, per checklist) |
| Custom Values (timeouts, defaults) | `CUSTOM_VALUES` | API (`scripts/onboard-client.ts`) |
| Workflows | `WORKFLOWS` | UI (manual, per checklist) |
| Tags | `TAGS` | API (implicit on first use) |
| Env vars | `ENV_VARS` | Vercel env, populated post-onboard |
| Stage transitions | `STAGE_TRANSITIONS` | Code (handler dispatch table) |

The handler code reads `STAGE_TRANSITIONS` to know what to do on every stage change — adding a new stage is a 5-line edit to the schema, not a 50-line edit to a handler.

---

## 2. Pipeline & stage map (locked names)

### 2.1 Lead Acquisition
*Tracks parents from opt-in until they book their first trial. One opp per parent contact.*

```
NEW LEAD ──── 24h timer ──► TRIAL NURTURE ──── 7d ──► NURTURE CAMPAIGN ──── 14d ──► LOST / COLD
   │                            │                          │                          │
   │  on first booking          │  on first booking        │  on first booking        │
   ▼                            ▼                          ▼                          ▼
INTRO BOOKED (WON) ◄───────────────────────────────────────                          (terminal)
                                                                                add `quarterly-reactivation` tag
```

### 2.2 Trial Conversion
*One opp per booked trial, disambiguated by `trainee_key`.*

```
INTRO BOOKED ──► TRIAL APPOINTMENT DONE ──► (admin classifies) ──► TRIAL ACTIVE NURTURE ──► STUDENT ENROLLED (WON)
                                                  │
                                                  ├─► NO-SHOW ──► INTRO CLASS REBOOKING ──► TRIAL INACTIVE REACTIVATION ──► LOST / COLD
                                                  │                       │                          │
                                                  │                  rebook fires                    │
                                                  │                  /api/book ────► back to INTRO BOOKED
                                                  │
                                                  └─► STUDENT ENROLLED (WON)  (admin direct-enroll path)

LOST / COLD ───► cross-pipeline ────► Lead Acquisition NURTURE CAMPAIGN
TRIAL ACTIVE NURTURE ───► creates CREDIT_MON opp at CREDIT ACTIVE
```

### 2.3 Trial Credit Monitoring
*One opp per active trial pass. Multiple opps per parent contact when there are multiple trainees.*

```
CREDIT ACTIVE ──► ANOTHER TRIAL BOOKED ──► (day-of) ──► APPOINTMENT TODAY ──► (admin)
   ▲                                                                              │
   │                                                                              ├─► ATTENDED APPOINTMENT ──► [decrement] ──► CREDIT ACTIVE | CREDITS EXHAUSTED
   │                                                                              │
   │                                                                              └─► NO-SHOW ──► CREDIT ACTIVE
   │                                                                                              (no decrement)
   │
   └── 14d idle ──► REACTIVATION ──── 21d ──► LOST ──► zero credits + Lead Acq → NURTURE CAMPAIGN
```

---

## 3. Endpoint catalog

### 3.1 `POST /api/lead`
Browser → website. Replaces the current direct-to-GHL form post.

```
Body:    { firstName, lastName, email, phone, source, message?, trainee?, page, ts, website }
Returns: { ok:true, contactId, opportunityId } | { ok:false, code }
Idempotency: sha1(email|trainee_key|source|YYYYMMDD), 24h
Side effects:
  1. Validate (Zod) + honeypot + dwell-time
  2. ghl-adapter.handleOptIn():
     a. POST /contacts/upsert
     b. PUT /contacts/:id (CFs: lead_source, last_trainee_key, credits_remaining if empty)
     c. POST /contacts/:id/tags (`source-${source}`)
     d. searchOpps(LEAD_ACQ, open) → if hit: refresh CFs; if miss: createOpp at NEW LEAD
     e. addToWorkflow(WORKFLOW_ID_NEW_LEAD_TIMER)
```

### 3.2 `POST /api/book` (extends existing)
Browser → website. Handles both initial trials and rebookings.

```
Body:    existing BookingRequest schema + { traineeKey?: string, rebookToken?: string }
Returns: { ok:true, appointmentId, contactId, opportunityId, isRebook } | { ok:false, code, alternates? }
Idempotency: sha1(email|trainee_key|slot_start_iso), 6h
Side effects:
  1. Existing layers 1–4 (validation, honeypot, dwell, IP rate-limit)
  2. Re-validate slot via getFreeSlots
  3. trainee_key = traineeKey.derive(...)
  4. ghl-adapter.handleBooking():
     a. upsertContact
     b. PUT contact CFs (last_trainee_key, household_trainee_keys append)
     c. PRE-POST REBOOK LOOKUP: searchOpps(TRIAL_CONV) + filter by trainee_key client-side
        - Trial Conversion opp open in INTRO BOOKED/INTRO CLASS REBOOKING/NO-SHOW → existingOpp
        - Credit Monitoring opp open in CREDIT ACTIVE → activeCreditOpp (different rebook path)
     d. Create appointment
     e. Branch:
        - existingOpp + Trial Conv (initial-trial rebook):
            updateOpp(existingOpp, last_appointment_*) + moveStage to INTRO BOOKED
        - activeCreditOpp (active-trial rebook):
            updateOpp(activeCreditOpp, last_appointment_*) + moveStage to ANOTHER TRIAL BOOKED
        - else (initial trial):
            createOpp(TRIAL_CONV, INTRO BOOKED, CFs)
            move Lead Acq opp → INTRO BOOKED (WON)
     f. addNote (audit)
```

### 3.3 `GET /api/availability`
Already exists; no change.

### 3.4 `POST /api/cancel`
Browser → website. Customer-initiated cancellation from confirmation page.

```
Body:    { appointmentId, contactId, reason?, token }
         token = HMAC-SHA256(appointmentId|contactId|exp, CANCEL_SIGNING_KEY) — 30-day expiry
Returns: { ok:true } | { ok:false, code }
Side effects:
  1. Verify HMAC token (constant-time)
  2. ghl-adapter.handleCancellation():
     a. PUT /calendars/events/appointments/:id (status='cancelled')
     b. PUT /opportunities/:oppId/status (lost or abandoned + reason)
     c. addNote
     d. addToWorkflow (cancel follow-up if exists)
```

### 3.5 `POST /api/rebook-lookup`
Browser → website. Fallback when active-trial student loses their magic link.

```
Body:    { email, lastName }
Returns: { ok:true, sessionToken, traineeName, creditsRemaining } | { ok:false, code }
Rate limit: 5 req/IP/hour (anti-enumeration)
Side effects:
  1. searchContacts({ email, lastName })
  2. If contact found: searchOpps(CREDIT_MON, open) → filter by isActive
  3. If active credit opp found: mint short-lived sessionToken (15-min expiry, signed)
     Return { sessionToken, traineeName, creditsRemaining }
  4. If not found: return generic { ok:false, code:'NOT_FOUND' } (no email-existence leak)
```

### 3.6 `POST /api/webhooks/ghl/stage-changed` (Trial Conversion)

```
Headers: X-GBW-Secret
Body:    { opp_id, contact_id, pipeline_id, from_stage, to_stage, trainee_key, ts }
Behavior: Look up STAGE_TRANSITIONS for (TRIAL_CONV, to_stage) and execute the action list.
Idempotency: ts + opp_id + to_stage, 24h
Returns 200 with ok:false on logical errors (don't trigger GHL retries).
```

### 3.7 `POST /api/webhooks/ghl/credit-stage-changed` (Trial Credit Monitoring)
Same shape as above, dispatched against `STAGE_TRANSITIONS` for `CREDIT_MON`.

### 3.8 `POST /api/webhooks/ghl/appointment-status`
Mirrors cancellations made directly in GHL UI (not via `/api/cancel`).

### 3.9 `GET /api/health/ghl`

```
Auth:    ?key=<HEALTH_KEY>
Returns: {
  ok: boolean,
  pit: 'ok' | 'fail',
  pipelinesMatch: boolean,
  customFieldsMatch: boolean,
  customValuesMatch: boolean,
  workflowsConfigured: boolean,
  rateLimitRemaining: number,
  drift: string[],   // human-readable list of mismatches
  resolved: { pipelines, customFields, workflows }   // for env-var population
}
Side effects: refreshes pipeline + custom-field caches; verifies live GHL state matches
              GHL_SCHEMA. Used both as bootstrap diagnostic and as ongoing drift detector.
```

---

## 4. Library structure

```
src/lib/
├── ghl.ts                     # EXTEND — keep getFreeSlots, upsertContact, createAppointment;
│                                delegate via new ghlFetch wrapper; allow per-call Version override
├── ghl-rate-limit.ts          # NEW — fetch wrapper, surfaces X-RateLimit-Remaining, queues at <5
├── ghl-pipelines.ts           # NEW — bootstrap GET /opportunities/pipelines, cache by name;
│                                resolves PIPELINES schema names → live IDs
├── ghl-custom-fields.ts       # NEW — discover + cache CF IDs by fieldKey; resolves
│                                CONTACT_CUSTOM_FIELDS / OPPORTUNITY_CUSTOM_FIELDS → live IDs
├── ghl-opportunities.ts       # NEW — searchOpps, findByTraineeKey, createOpp, updateOpp,
│                                moveStage, setStatus
├── ghl-adapter.ts             # NEW — domain orchestrators (the only thing endpoints call):
│                                handleOptIn, handleBooking, handleAttendance,
│                                handleCreditDecrement, handleCancellation, handleStageTransition
├── stage-transitions.ts       # NEW — generic dispatcher: given (pipelineKey, enterStage),
│                                execute the action list from STAGE_TRANSITIONS
├── trainee-key.ts             # NEW — deriveTraineeKey({ email, firstName, dob })
├── idempotency.ts             # NEW — Map-backed for v1, swappable to Upstash Redis
├── webhook-secrets.ts         # NEW — verifySecret(req) for X-GBW-Secret, timingSafeEqual
├── rebook-token.ts            # NEW — HMAC sign/verify for /rebook magic links
├── cancel-token.ts            # NEW — HMAC sign/verify for /api/cancel tokens
└── booking-types.ts           # EXTEND — Zod schemas for all new request/response shapes

config/
└── ghl-schema.ts              # NEW — single source of truth (already written)

scripts/
└── onboard-client.ts          # NEW — bootstrap CLI for new client setup

src/pages/api/
├── availability.ts            # EXISTS — no change
├── book.ts                    # EXTEND with rebook-aware adapter
├── lead.ts                    # NEW
├── cancel.ts                  # NEW
├── rebook-lookup.ts           # NEW
├── health/ghl.ts              # NEW
└── webhooks/ghl/
    ├── stage-changed.ts       # NEW
    ├── credit-stage-changed.ts # NEW
    └── appointment-status.ts  # NEW

src/pages/
└── rebook.astro               # NEW — active-trial rebooking page (PR 5)

src/components/booking/
├── DatePicker.astro           # EXISTS — reused on /rebook
├── SlotPicker.astro           # EXISTS — reused on /rebook
├── BookingSuccess.astro       # EXISTS — reused on /rebook
└── RebookHeader.astro         # NEW — greeting + credits remaining
```

---

## 5. Build phases

### Phase 0 — Reproducibility tooling (1 PR, prerequisite)

**Scope:** No behavior change. Lay the reproducibility rails before any feature work.

**Files:**
- `config/ghl-schema.ts` (already written — see file)
- `scripts/onboard-client.ts` — Node CLI:
  - Reads `GHL_SCHEMA`, prompts operator for PIT + locationId
  - Calls GHL API to discover existing pipelines, CFs, workflows
  - Creates `CUSTOM_VALUES` via API where they don't exist
  - Prints checklists for UI-only assets (pipelines, CFs, workflows) with the **exact stage names and field keys** from the schema
  - On re-run after operator does manual UI work: discovers IDs, writes `.env.client.local`
- `docs/replication/ghl-onboarding-runbook.md` — operator-facing doc (1-page)
- `.env.example` — every entry from `ENV_VARS`

**Test plan:**
1. On a throwaway GHL sub-account: `npm run onboard:ghl` → checklist printed
2. Manually create the listed pipelines/CFs/workflows in GHL UI
3. Re-run the script → IDs resolved, env file written
4. Diff env file against expected list — all entries populated

**After merge:** Reproducibility tooling exists. No production behavior change yet. PR 1 can begin.

---

### Phase 1 — Foundations (1 PR)

**Scope:** Refactor existing code to use the new libs. No new endpoints.

**Files:**
- `src/lib/ghl-rate-limit.ts`
- `src/lib/ghl-pipelines.ts`
- `src/lib/ghl-custom-fields.ts`
- `src/lib/idempotency.ts`
- `src/lib/webhook-secrets.ts`
- `src/lib/trainee-key.ts`
- `src/lib/cancel-token.ts`
- `src/lib/rebook-token.ts`
- `src/lib/booking-types.ts` (extend with new Zod schemas)
- `src/pages/api/health/ghl.ts`
- Refactor `src/lib/ghl.ts` to delegate `request()` → `ghlFetch()`

**Test plan:**
- `GET /api/health/ghl?key=…` on preview returns ok:true with all pipelines/CFs/workflows resolved
- Existing `/api/availability` and `/api/book` smoke tests pass unchanged

**After merge:** Boot diagnostics work. Caches populated. Existing endpoints unchanged externally.

---

### Phase 2 — Opt-in endpoint + Lead Acquisition pipeline (1 PR)

**Scope:** Migrate forms from direct-to-GHL webhooks to the new `/api/lead` endpoint. Lead Acquisition pipeline becomes live.

**Files:**
- `src/lib/ghl-opportunities.ts`
- `src/lib/ghl-adapter.ts` (just `handleOptIn` for now)
- `src/pages/api/lead.ts`
- Update `src/components/form/OptInForm.astro` (3 instances) → POST to `/api/lead`
- Update `src/pages/contact.astro` form → POST to `/api/lead`
- Keep `PUBLIC_GHL_WEBHOOK_URL` in env as fallback for 2-week safety net

**Test plan:**
- Submit each form variant on preview
- Verify in GHL UI: contact has `lead_source` CF, Lead Acquisition opp at NEW LEAD, "Trial Nurture Campaign" workflow enrolled (after 24h timer or manually advanced)
- Submit duplicate within 24h → idempotent replay (200 with cached contactId)
- Multi-child opt-in (same parent, different traineeFirstName/dob) → single Lead Acq opp, household_trainee_keys has both keys

**After merge:** Lead Acquisition pipeline fully automated.

---

### Phase 3 — Booking + rebook detection + Trial Conversion pipeline (1 PR)

**Scope:** Extend `/api/book` for rebook detection. Trial Conversion pipeline becomes live.

**Files:**
- `src/lib/ghl-adapter.ts` (add `handleBooking`)
- Modify `src/pages/api/book.ts`:
  - Replace fire-and-forget `GHL_APPOINTMENT_WEBHOOK_URL` POST with `ghl-adapter.handleBooking()`
  - Return `{ appointmentId, contactId, opportunityId, isRebook }`
- Decommission `GHL_APPOINTMENT_WEBHOOK_URL` (warn if still set)
- Update analytics: `booking_initiated` and `booking_complete` dataLayer events get `is_rebook` flag

**Test plan:**
- Initial trial booking → Trial Conversion opp at INTRO BOOKED, Lead Acquisition opp moves to INTRO BOOKED (WON), audit note added
- Same trainee books second slot → `isRebook: true`, no new opp, existing opp stage stays INTRO BOOKED, last_appointment_* updated
- Different sibling books → second Trial Conversion opp created
- Walk through: NO-SHOW (manual move in GHL) → INTRO CLASS REBOOKING auto-fires → rebook → opp goes back to INTRO BOOKED

**After merge:** Booking + initial-trial rebook automation. Trial Conversion pipeline live.

---

### Phase 4 — Inbound webhooks + Trial Credit Monitoring + cancellation (1 PR)

**Scope:** Wire up the GHL → website backflow. Trial Credit Monitoring pipeline becomes live.

**Files:**
- `src/lib/ghl-adapter.ts` (add `handleAttendance`, `handleCreditDecrement`, `handleCancellation`, `handleStageTransition`)
- `src/lib/stage-transitions.ts` (generic dispatcher reading `STAGE_TRANSITIONS`)
- `src/pages/api/webhooks/ghl/stage-changed.ts`
- `src/pages/api/webhooks/ghl/credit-stage-changed.ts`
- `src/pages/api/webhooks/ghl/appointment-status.ts`
- `src/pages/api/cancel.ts`
- Update confirmation page to include cancel link with HMAC token
- GHL UI work (documented in `docs/replication/ghl-onboarding-runbook.md`):
  - Build the 3 backflow workflows (Trial Conv, Credit Mon, Appointment Status)
  - Each has a webhook action with `X-GBW-Secret` custom header

**Test plan:**
- Move Trial Conversion opp → TRIAL ACTIVE NURTURE in GHL UI → Credit Monitoring opp created at CREDIT ACTIVE with `credits_remaining_display` = TRIAL_CREDITS_DEFAULT
- Move Credit opp through ANOTHER TRIAL BOOKED → APPOINTMENT TODAY → ATTENDED APPOINTMENT → contact.credits_remaining decrements; auto-progresses to CREDIT ACTIVE (if > 0) or CREDITS EXHAUSTED (if 0)
- Mark NO-SHOW in Credit Mon → no decrement, auto-back to CREDIT ACTIVE
- Cancel via confirmation page → appointment status flips, opp goes abandoned, audit note added
- Cancel in GHL UI → appointment-status webhook fires, opp goes abandoned

**After merge:** Full lifecycle automated from opt-in to enrollment (or churn).

---

### Phase 5 — Active-trial rebooking page (1 PR)

**Scope:** Dedicated `/rebook` page for active-trial students.

**Files:**
- `src/pages/rebook.astro`
- `src/components/booking/RebookHeader.astro`
- `src/pages/api/rebook-lookup.ts`
- (optional) Generate magic links: at trial activation in `handleAttendance`, mint a token via `rebook-token.ts` and PUT it onto `OPPORTUNITY_CUSTOM_FIELDS.rebook_link_token`. GHL templates merge it into rebooking SMS/email bodies.

**Test plan:**
- Magic link path: open `/rebook?t=<valid-token>` → personalized greeting, credits shown, slot picker works, booking creates ANOTHER TRIAL BOOKED opp move
- Lookup path: open `/rebook` → enter email + last name → if active credit found: same flow; if not: generic error
- Token expiry: open `/rebook?t=<expired-token>` → falls back to lookup form
- Rate-limit lookup: hit `/api/rebook-lookup` 6 times from same IP → 429

**After merge:** Active-trial students have a friction-free rebooking experience.

---

### Phase 6 (optional, post-launch) — Hardening

- Swap `idempotency.ts` Map → Upstash Redis (Vercel Marketplace) for cold-start durability
- Add Sentry/Axiom adapter to structured log emit
- Cron `/api/health/ghl` every 6h, post drift to admin notification workflow

---

## 6. Configuration & onboarding flow

### 6.1 New-client onboarding (target: <2 hours from clone to live)

```
1. git clone the repo, deploy to Vercel under client domain
2. In GHL: create sub-account, generate PIT (with required scopes — see below)
3. cp .env.example .env  (locally) and fill in:
     GHL_PIT_TOKEN, GHL_LOCATION_ID
     (skip pipeline/workflow IDs for now — will be discovered)
4. npm run onboard:ghl
   → creates Custom Values automatically
   → prints checklist: which pipelines, stages, CFs, workflows to create in GHL UI
5. Operator clicks through GHL UI for ~30-60 min following checklist
   → creates 3 pipelines with exact stage names from schema
   → creates contact + opportunity custom fields with exact field keys
   → creates 16 workflows (12 campaigns + 3 backflow webhooks + 1 quarterly tag)
   → for each backflow workflow: adds X-GBW-Secret custom header
6. npm run onboard:ghl  (re-run)
   → discovers IDs, writes .env.client.local
   → diff against ENV_VARS — confirms nothing missing
7. Copy .env.client.local values into Vercel project env vars
8. Trigger Vercel redeploy
9. GET https://<domain>/api/health/ghl?key=<HEALTH_KEY>
   → returns ok:true with no drift
10. Test end-to-end: submit opt-in form, verify in GHL UI
```

### 6.2 Required PIT scopes

```
contacts.readonly, contacts.write
opportunities.readonly, opportunities.write
calendars.readonly, calendars/events.readonly, calendars/events.write
locations.readonly
workflows.readonly
conversations/message.write   # only if sending SMS programmatically
```

### 6.3 Per-call API headers

```
Authorization: Bearer <GHL_PIT_TOKEN>
Version: 2021-07-28          # per-call override allowed via ghlFetch options
Accept: application/json
Content-Type: application/json
```

`ghl-rate-limit.ts` surfaces `X-RateLimit-Remaining` to logs every call. When < 5, queue with backoff. When 0, throw `GhlError(429)`.

---

## 7. Error handling & observability

### Error code table

| HTTP | Code | Meaning |
|---|---|---|
| 400 | `INVALID_INPUT` | Zod validation failure |
| 400 | `INVALID_EMAIL` / `MISSING_TRAINEE` / `INVALID_DOB` | Field-specific |
| 401 | `INVALID_SECRET` | Webhook secret mismatch |
| 401 | `INVALID_TOKEN` | Cancel/rebook HMAC fail |
| 404 | `NOT_FOUND` | Lookup miss (generic — no enumeration leak) |
| 409 | `SLOT_TAKEN` | Booking slot gone |
| 429 | `RATE_LIMITED` | IP bucket OR `X-RateLimit-Remaining` < 5 |
| 502 | `GHL_FAILED` | GHL upstream 4xx/5xx |
| 200 | `IDEMPOTENT_REPLAY` | Cached prior response |

Webhook endpoints return 200 with `{ ok: false, code }` on logical errors so GHL doesn't infinite-retry. Non-200 only on auth failure.

### Structured logs (one JSON line per request)

```json
{
  "event_type": "lead.opt_in | booking.create | booking.rebook | attendance.recorded | credit.decrement | cancellation",
  "request_id": "<uuid>",
  "contact_id": "...", "opp_id": "...", "trainee_key": "...",
  "ghl_calls": [
    { "path": "/contacts/upsert", "method": "POST", "status": 200, "duration_ms": 142, "version": "2021-07-28" }
  ],
  "rate_limit_remaining": 87,
  "duration_ms": 612,
  "outcome": "ok | idempotent_replay | ghl_failed | validation_failed",
  "schema_version": "<git sha of config/ghl-schema.ts>"
}
```

`schema_version` lets us correlate behavior across schema revisions when debugging multi-client incidents.

---

## 8. Open items at build time

These are decisions that block specific phases — not blockers for starting Phase 0.

1. **`Trial Credit Monitoring LOST → Lead Acquisition NURTURE CAMPAIGN`** — locked. The user clarified "the nurture stage in lead acquisition," and NURTURE CAMPAIGN is the right semantic match (last-chance, not fresh-lead).
2. **INTRO BOOKED → TRIAL APPOINTMENT DONE auto-move** — assumption: opp auto-moves to TRIAL APPOINTMENT DONE on appointment end time (so admin sees a daily "classify these" list). Confirm before Phase 4.
3. **Quarterly reactivation timing** — the `quarterly-reactivation` tag is added on LOST/COLD entry; the actual quarterly winback workflow is out of scope for this build but the tag is the trigger.
4. **Admin notifications workflow ID** — placeholder in schema, to be filled in by operator during onboarding (the "Add to Workflow" call references it by env var).
5. **Rebook token storage** — Phase 5 stores the magic-link token on the Credit Monitoring opp's `rebook_link_token` CF. Verify this CF is added to the GHL UI checklist.

---

## 9. Why this is reproducible

Every per-client artifact is one of three categories:

| Category | Lives where | Per-client work |
|---|---|---|
| **Schema (the same for every client)** | `config/ghl-schema.ts` | None — code |
| **GHL state (same shape, per-client IDs)** | GHL UI | 30–60 min of clicking from a generated checklist |
| **Secrets + IDs** | Vercel env vars | Copy-paste from `onboard:ghl` output |

A second client onboarding looks identical to GBW's — the schema doesn't change, only the IDs do. If GBW asks for a stage rename or a new campaign, that's a schema PR; once merged, every client gets it on next deploy + onboard re-run.

The handler code never references stage names or pipeline IDs as string literals — it always goes through `PIPELINES.LEAD_ACQ.stages`, `STAGE_TRANSITIONS`, etc. This is the line that makes the system reproducible: schema edits flow through to behavior with no scattered code changes.

---

## 10. Files referenced

- [`config/ghl-schema.ts`](../../config/ghl-schema.ts) — single source of truth
- [`docs/replication/ghl-automation-plan.md`](./ghl-automation-plan.md) — workflow logic plan (will be updated to match locked stage names)
- [`docs/replication/ghl-onboarding-runbook.md`](./ghl-onboarding-runbook.md) — operator-facing onboarding doc (Phase 0 deliverable)
- `src/lib/ghl.ts` — existing PIT client; extended in Phase 1
- `src/pages/api/availability.ts` — existing; no change
- `src/pages/api/book.ts` — extended in Phase 3
- `.env.example` — Phase 0 deliverable, lists every entry from `ENV_VARS`
