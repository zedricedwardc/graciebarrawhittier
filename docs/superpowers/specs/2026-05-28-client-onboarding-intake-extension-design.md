# Client onboarding intake extension — design

**Date:** 2026-05-28
**Scope:** Option C from brainstorming — *inputs collection only*. Extends `docs/replication/CLIENT_INTAKE.template.md` so a newly-signed studio can self-serve every input we need to deliver website + Academy Launch Machine (GHL) + Revive + Firestorm + Back to the Mats. Procedure/runbook for *using* these inputs lives in `REPLICATE.md` and the per-campaign setup docs and is out of scope here.

## Problem

The existing `CLIENT_INTAKE.template.md` was built for the technical replication only (website + GHL provisioning). It does not capture:

- Inputs for the three growth campaigns we run at kickoff (Revive cold-lead reactivation, Firestorm Google reviews, Back to the Mats former-student re-enrollment)
- Access we need beyond GHL + Vercel (domain registrar, GBP, payment processor, prior CRM, A2P 10DLC)
- Operational rules the workflows depend on (calendar capacity, lead routing, SMS quiet hours, lead-claim rule)
- Who at the studio we talk to + who can approve decisions

Today this information is gathered ad-hoc over Slack and email after a contract is signed, which causes preventable delays and forces the operator to chase inputs mid-replication.

## Decisions (from brainstorming)

1. **Scope is inputs only.** Procedure stays in `REPLICATE.md` + per-campaign docs.
2. **Delivery is self-serve.** Client fills the doc themselves; we audit.
3. **Single source of truth.** Extend `CLIENT_INTAKE.template.md` in place — do not fork a second intake.
4. **Campaign sections are optional.** Each of the three campaigns has a section the client can skip ("no list available"); the campaign is then deferred, not silently dropped.
5. **Append, don't restructure.** Existing §§1-13 are unchanged so `REPLICATE.md` references (`intake §6`, `intake §9`, etc.) don't break.
6. **Compliance attestations are folded inline** into the relevant campaign sections, not split into a separate "compliance" section.

## What gets added

Six new sections appended to `CLIENT_INTAKE.template.md`:

| § | Title | Purpose |
|---|---|---|
| 14 | Point of contact | Who at the studio we talk to; who can approve copy/design |
| 15 | Access & integrations | Every login/credential beyond GHL + Vercel |
| 16 | Studio operations | Operational rules the workflows depend on |
| 17 | Revive campaign (optional) | Cold-lead list + dead-lead definition + TCPA attestation + offer |
| 18 | Firestorm campaign (optional) | Recent-student list + GBP verification + LocalCraze + baseline |
| 19 | Back to the Mats (optional) | Former-student list + TCPA attestation + offer + deadline |

Existing §§1-13 are not touched. Cross-references already pointed at the template (e.g., `REPLICATE.md` phase 1 step 1 referencing `intake §1`) continue to resolve.

## Field detail by section

### §14 Point of contact

- **REQUIRED:** Primary contact name + role (e.g., `Jane Doe — Owner`)
- **REQUIRED:** Primary contact email (real human inbox, not `info@`)
- **REQUIRED:** Primary contact mobile phone (for SMS-grade urgency only)
- **REQUIRED:** Decision authority — who can approve copy/design/offer changes (name + email; can equal primary)
- **REQUIRED:** Preferred comms channel — Slack invite / email / SMS / WhatsApp
- (optional) Timezone if not `America/Los_Angeles`
- (optional) Secondary/backup contact (name + email)

### §15 Access & integrations

- **REQUIRED:** Domain registrar name (GoDaddy / Namecheap / Cloudflare / Google Domains / other) — option: grant us account access OR add DNS records we email
- **REQUIRED:** Google Business Profile — verified? (yes / no / in progress). If yes: invite `<agency-google-email>` as Manager. If no: schedule verification call before Firestorm launch
- (recommended) Google Search Console — invite `<agency-google-email>` as Owner
- (optional) Google Analytics — existing GA4 property ID + invite; or "create new"
- (optional) Meta Business Manager — accept partner request from BM ID `<our-bm-id>`
- **REQUIRED:** Email sending domain — confirm you can add SPF/DKIM/DMARC records we send (or grant registrar access from above)
- **REQUIRED:** SMS — A2P 10DLC brand + campaign registration status (registered / pending / not started). If not started, we file on your behalf — need legal entity name, EIN, website URL, sample messages
- **REQUIRED:** Payment processor for online intro/BTM/membership — Stripe Connect via GHL (default; we provision) OR existing Stripe (provide account email)
- (optional) Existing website URL + CMS (WordPress / Wix / Squarespace / other)
- (optional) Prior CRM/booking system (Mindbody / Zen Planner / Kilo / Jackrabbit / spreadsheet / none) + admin login (read-only OK) for one-time export — drives §17/§19 list extraction

### §16 Studio operations

- **REQUIRED:** Per-program calendar capacity — max bookings per slot, per program (e.g., `Tiny: 8 / LC1: 10 / Adults: 20`)
- **REQUIRED:** New-lead notification routing — name(s) + email + mobile of staff pinged on every website lead; channel(s): email / SMS / GHL mobile-app push
- **REQUIRED:** SMS bot quiet hours — default `08:00–21:00 local`; confirm or override (TCPA: cannot text outside `08:00–21:00` recipient-local)
- **REQUIRED:** After-hours auto-reply window — when live-response flips to auto-reply (e.g., M–F `09:00–19:00`, Sat `09:00–14:00`, Sun closed)
- **REQUIRED:** Lead-claim rule — round-robin / owner-only / first-to-respond
- **REQUIRED:** Year's closure dates — holidays / vacation blocks (drives `blackouts.ts`; already cross-referenced from §4)

### §17 Revive campaign (optional — skip if no cold-lead list)

- (optional) Cold-lead list CSV → `drafts/lists/revive-leads.csv`. Required columns: `firstName,lastName,email,phone,last_contact_date,source`. UTF-8, comma-separated.
- **REQUIRED if list provided:** Definition of "dead lead" — date cutoff (e.g., last contact >90 days) AND/OR status filter (never converted, never showed)
- **REQUIRED if list provided:** Estimated list size after the filter
- **REQUIRED if list provided:** TCPA SMS-consent attestation — for every phone, attest one of: (a) prior signed intake captured SMS consent; (b) verbal opt-in logged in CRM; (c) check to confirm we strip non-consenting numbers pre-send
- **REQUIRED if list provided:** Do-not-contact suppression — paste emails/phones to exclude
- **REQUIRED if list provided:** Revive offer — `use same intro offer` OR custom copy + price + deadline
- (optional) Bot persona override — default `Alex`; provide first name + pronouns + one-sentence persona note if different
- **REQUIRED if list provided:** Launch timing — `day 1 of go-live` / `N days after go-live` / `paused until I trigger`

### §18 Firestorm campaign (optional — skip if GBP not verified)

- **REQUIRED:** GBP verification status — verified / pending / not started. Hard gate: Firestorm cannot launch unverified.
- **REQUIRED:** GBP place ID (cross-ref §2; restate for sanity)
- (optional) Recent-student CSV → `drafts/lists/firestorm-students.csv`. Required cols: `firstName,lastName,email,phone,last_class_date,enrollment_status`. Without it, Firestorm starts cold from post-launch students.
- **REQUIRED if list provided:** TCPA SMS-consent attestation (same a/b/c as §17)
- **REQUIRED:** Current Google rating + review count — recorded as before/after baseline (e.g., `4.6 stars, 18 reviews`)
- (optional) LocalCraze widget — `we provision new` (default) / `existing — provide embed ID`
- (optional) Review request copy — `use template` (default) / custom email + SMS body
- **REQUIRED:** Launch timing (same options as §17)

### §19 Back to the Mats (optional — skip if no former-student list)

- (optional) Former-student CSV → `drafts/lists/btm-students.csv`. Required cols: `firstName,lastName,email,phone,last_attended_date,programs_enrolled`.
- **REQUIRED if list provided:** "Former" definition — date range (e.g., lapsed 6–24 months ago) + exclusions (refund/banned)
- **REQUIRED if list provided:** Estimated list size after the filter
- **REQUIRED if list provided:** TCPA SMS-consent attestation (a/b/c). BTM is the highest-risk campaign for TCPA complaints — former students actively churned — so consent quality matters.
- **REQUIRED if list provided:** BTM offer — copy + price + deadline (e.g., `Back to the Mats Special — $97 for 30 days unlimited, deadline Friday June 8 2026`)
- **REQUIRED if list provided:** Launch timing (same options as §17)

## File touched

- `docs/replication/CLIENT_INTAKE.template.md` — append §§14-19 after the existing §13.
- `docs/replication/CLIENT_INTAKE.template.md` — update the `## Done?` checklist at the bottom to include the new sections (only the unconditionally-required ones; the campaign sections are tick-N/A if skipped).

No other files require changes in this spec. Procedure-side work (REPLICATE.md updates, validation script updates, list-ingestion scripts) is a separate spec.

## Out of scope

- The validator (`npm run validate:intake`) is not updated here. It will continue to validate §§1-13 only; §§14-19 are unvalidated text fields until a follow-up spec adds them.
- Per-campaign list ingestion (loading `drafts/lists/*.csv` into GHL, deduping, TCPA-filtering) is a separate procedural spec.
- The HANDOFF.md template in `REPLICATE.md` phase 8 is not updated to reference §§14-19; that's also follow-up.
- A "sales discovery" or "post-launch retention" doc — out of scope per Q1 (we chose option C).

## Acceptance

- `docs/replication/CLIENT_INTAKE.template.md` has six new sections numbered 14-19 with the field lists above.
- `## Done?` checklist at the bottom includes the new sections.
- Existing §§1-13 are byte-identical to before (`git diff` shows append-only).
- A non-technical studio owner can read each new section and either (a) fill it in or (b) tick "skip — campaign deferred" without ambiguity.
