# Gracie Barra Whittier — Template Repo

Astro 6 + Vercel + GoHighLevel marketing-and-CRM template for martial-arts studios. Designed to be forked for any new client location with one filled intake document and a single AI-driven build pass.

## What this is

A lead-capture and class-booking site with deep CRM integration: opt-in flows, trial booking, rebook flows, Back-to-the-Mats reactivation, SMS bot, and GHL workflow orchestration. GHL itself is the system of record. The Astro site is a thin presentation + validation layer.

**Stack:** Astro 6 (App Router, MDX content collections) → API routes (Zod-validated) → single domain orchestrator (`src/lib/ghl-adapter.ts`) → GHL HTTP client. Hosted on Vercel.

**Architecture overview:** [`docs/superpowers/specs/2026-05-27-ai-replication-spec-design.md`](docs/superpowers/specs/2026-05-27-ai-replication-spec-design.md)

---

# Replication Guide

This repo is built to be replicated. The guide below is split by audience — pick the section that matches you.

| You are… | Read |
|---|---|
| The studio owner or franchise admin (non-technical) | [§A — For Human Operators](#a--for-human-operators) |
| A developer running the build yourself | [§B — For Developers](#b--for-developers) |
| An AI session being asked to execute the replication | [§C — For AI Sessions](#c--for-ai-sessions) |

---

## A — For Human Operators

You're the studio owner, franchise admin, or marketing lead who needs a new site stood up. You don't need to write code. You need to **prepare the inputs** and **review the output**.

### What you'll get when this is done

- A live website at your domain (e.g., `graciebarrachicago.com`)
- Branded, with your logo + colors + photos
- Lead-capture form wired into your GHL sub-account
- Trial-booking calendar wired into your GHL calendars
- SMS + email automation running through your GHL workflows
- Reviews showing from your Google Business Profile
- SEO-optimized landing pages for every neighboring city you want to target

### What you need to prepare (the intake)

Open [`docs/replication/CLIENT_INTAKE.template.md`](docs/replication/CLIENT_INTAKE.template.md). Save a copy as `CLIENT_INTAKE.md`. Fill every section marked `REQUIRED`. The 13 sections cover:

1. **Identity** — business name, brand name, domain, tagline
2. **NAP** — name, address, phone (verbatim — appears on every page, in schema, in footer)
3. **Brand** — 3 logo SVGs (horizontal, vertical, icon-only), favicon, 3 colors, brand voice
4. **Programs offered** — which kids tiers, which adult tiers, BTM enabled, schedule blocks
5. **Instructors** — name, belt, lineage, years training/teaching, certifications, headshot, bio notes
6. **Locations served** — 3–5 neighboring cities with landmarks + demographic notes (drives SEO pages)
7. **Reviews** — Google Place ID (preferred) OR manual review list
8. **Offer** — trial details (number of classes, what's included, risk-reducer copy)
9. **GHL workspace** — sub-account ID + Private Integration Token
10. **Deploy** — Vercel team name, project name, who handles DNS
11. **Legal** — waiver, photo release, safety policies (template or custom)
12. **Assets** — URLs to studio photos (interior, kids in action, adults in action, headshots)
13. **SMS/email overrides** — optional, leave blank to use template defaults

The intake template has detailed prompts and examples for every field. **Do not skip REQUIRED fields** — the build will halt rather than substitute, by design.

### The build process from your point of view

1. **You fill** `CLIENT_INTAKE.md`. Time: 2–4 hours, mostly waiting on logo files and reviewing your own photo library.
2. **You hand** the filled intake + this repo to your developer or to an AI session with the instruction: *"Execute `docs/replication/REPLICATE.md`"*.
3. **The AI builds in 9 phases**, pausing at three checkpoints for your input:
   - **After Phase 2** — the AI drafts content (city landing pages, instructor bios, hero variants). You review them in the `drafts/` folder and approve.
   - **During Phase 4** — the AI generates a GHL UI checklist. You do the clicks in your GHL dashboard (pipelines, custom fields, workflows — see [GHL dashboard build guide](docs/replication/ghl-dashboard-build-guide.md)). Time: 1–2 hours.
   - **After Phase 7** — the AI gives you a preview URL. You smoke-test it.
4. **You promote to production** with one command (`vercel promote <preview-url> --prod`), then do the DNS swap.

### What you still need to do AFTER the AI finishes

The AI generates a `HANDOFF.md` file in your new repo listing every operator-only item:

- Real studio photos (if the intake used placeholder URLs)
- Real parent testimonials for the kids page (if you didn't have any in intake §7)
- DNS swap to point your domain at Vercel
- Production promote
- Final smoke-test on the live URL

This is intentionally **not automated** — these are decisions and authentications that need to stay with you.

### Timing

End-to-end, from "intake filled" to "live site at your domain":

- Intake prep (you, async): **2–4 hours**
- AI build phases 0–3: **30–60 minutes** (largely automated; you review drafts in the middle)
- Operator GHL UI work (phase 4b): **1–2 hours**
- AI phases 4c–7: **15–30 minutes**
- Operator handoff items (DNS, photos, promote): **same-day to several days**, depends on you

---

## B — For Developers

You're running the build yourself, with or without AI assistance. Read this section in full before starting.

### Prerequisites

- `node ≥22.12`, `npm`, `git` on your PATH
- `vercel` CLI installed and logged in (`npm i -g vercel`, then `vercel login`)
- `tsx` (comes via devDependencies)
- A filled `CLIENT_INTAKE.md` (see §A above)
- The new client's **GHL sub-account ID** (`GHL_LOCATION_ID`) and **Private Integration Token** (`GHL_PIT_TOKEN`) — created in GHL → Settings → Private Integrations, with these scopes:
  - `View/Edit Contacts`, `View/Edit Opportunities`, `View/Edit Calendars`, `View/Edit Workflows`, `View/Edit Custom Fields`, `View/Edit Custom Values`, `View/Edit Tags`, `View/Edit Locations`
- Vercel team/org name (from `vercel teams ls`)

### Hard rules (these apply at every phase — do not violate)

1. **No silent invention.** If an intake field is missing or an asset URL returns non-200, halt with a precise error naming the field/URL. Never substitute.
2. **No production promotion.** Stop at a Vercel preview deployment. The operator (or studio owner) flips it to prod.
3. **Configurable values live in GHL custom values, not env vars.** Env vars are reserved for secrets + GHL resource IDs (location ID, PIT, webhook secret, signing keys). Things like trial deadlines, copy, prices, page URLs, timeouts — all live in GHL custom values so the studio admin can change them without a redeploy. ([memory rule](https://github.com/zedricedwardc/graciebarrawhittier))
4. **Vercel handles apex/www canonicalization in its dashboard.** Do NOT add a conflicting redirect in `vercel.json` — it loops and breaks the site.
5. **PII discipline.** When logging, redact emails as SHA-256 prefix (matches `src/pages/api/book.ts`).
6. **Idempotency.** Re-running any phase must not duplicate created assets — always check for existing state first.
7. **Halt on fail.** Don't advance past a phase whose acceptance criteria failed. Surface the failure; the operator decides fix-and-retry vs. abort.

### The 9 phases

Full procedure with exact commands lives in [`docs/replication/REPLICATE.md`](docs/replication/REPLICATE.md). Summary:

| Phase | What | Operator checkpoint |
|---|---|---|
| **0 — Preflight** | Validate intake, verify PIT works, verify Vercel auth | none — auto-proceeds if green |
| **1 — Repo fork + brand swap** | Copy template → new repo, replace logos/colors/favicon, regenerate OG images | operator reviews visual diff |
| **2 — Content production** | AI drafts city pages, bios, hero variants to `drafts/` | **operator reviews/edits drafts** |
| **3 — Content swap** | Apply approved drafts + direct-from-intake values into `src/content/`, `src/data/`, `src/pages/` | none |
| **4 — GHL provisioning** | (4a) AI generates UI checklist → (4b) operator does UI clicks → (4c) AI discovers IDs + provisions custom values + tags | **operator does UI clicks between 4a and 4c** |
| **5 — Env + secrets wiring** | Generate webhook/signing keys, push every env var to Vercel for both `production` and `preview` | none |
| **6 — Deploy preview** | `vercel deploy` (no `--prod`) | none |
| **7 — Verification** | `/api/health/ghl` returns all-green, synthetic lead end-to-end test, `npm test`, `npm run check` | none |
| **8 — Handoff generation** | Write `HANDOFF.md` with remaining operator work; commit; push | operator owns from here |

### Quickstart (TL;DR command flow)

If your intake is filled and your tokens are exported, the developer path is roughly:

```bash
# Prereqs
node -v                                # must be ≥ 22.12
vercel whoami                          # must print your username
export GHL_PIT_TOKEN=<pit>             # the NEW client's PIT
export GHL_LOCATION_ID=<loc>           # the NEW client's sub-account

# Validate intake
npm run validate:intake CLIENT_INTAKE.md

# Phase 1 — fork
cp -R . ../<new-slug>
cd ../<new-slug>
rm -rf .git && git init && git add . && git commit -m "chore: initial fork"
# (then: swap logos, edit src/styles/tokens.css colors, edit astro.config.mjs site,
#   edit package.json name, then npm install && npm run prebuild)

# Phase 2 — drafts (AI writes to drafts/, operator reviews)
# Phase 3 — content swap (edit src/content/*, src/data/*, src/pages/*)
npm test && npm run check              # both must pass

# Phase 4 — GHL provisioning
npm run onboard:ghl checklist          # generates UI todo list
# … operator does the UI clicks in GHL …
npm run onboard:ghl discover           # writes .env.client.local with IDs
npm run onboard:ghl provision          # creates custom values + tags

# Phase 5 — env wiring
# … generate fresh signing keys, merge .env.client.local into .env.production,
#   then vercel env add each key for production + preview …

# Phase 6 — deploy
vercel link --project <name> --yes
vercel deploy

# Phase 7 — verify
curl -s <preview-url>/api/health/ghl | jq

# Phase 8 — handoff
# … write HANDOFF.md from template, commit, push …
```

**Read the full procedure** at [`docs/replication/REPLICATE.md`](docs/replication/REPLICATE.md) before running these — the summary above leaves out important detail (rate limits, idempotency checks, what to do when a phase halts).

### Required environment variables

Set every key below in Vercel for both `production` and `preview` environments:

| Key | Where it comes from | Notes |
|---|---|---|
| `GHL_LOCATION_ID` | Intake §9 | Same value as `PUBLIC_GHL_LOCATION_ID` |
| `GHL_PIT_TOKEN` | Intake §9 | Server-side only — never expose in `PUBLIC_*` |
| `GHL_WEBHOOK_SECRET` | Generated in Phase 5 (32 random chars) | Must match the value pasted into GHL workflow webhook actions |
| `CANCEL_SIGNING_KEY` | Generated in Phase 5 | HMAC key for cancel-link signing |
| `REBOOK_SIGNING_KEY` | Generated in Phase 5 | HMAC key for rebook-link signing |
| `PUBLIC_GHL_LOCATION_ID` | Same as `GHL_LOCATION_ID` | Required by the chat widget embed |
| `PUBLIC_GHL_WEBHOOK_URL` | GHL → Pipeline 1 workflow → webhook URL | If unset, opt-in form falls back to local stub (won't reach GHL) |
| `PUBLIC_GHL_CHAT_WIDGET_ID` | GHL → Conversations → Chat Widget → Widget ID | Powers the AI chat bubble |
| `PUBLIC_REVIEWS_EMBED_ID` | LocalCraze reviews widget config | Reviews widget embed |
| `PUBLIC_GTM_ID` | GTM container ID (`GTM-XXXXX`) | Optional; gated in BaseLayout if unset |
| `PUBLIC_GA4_ID` | GA4 measurement ID (`G-XXXXX`) | Optional |

**Everything else** that a non-developer might want to change (trial offer copy, deadlines, prices, page URLs, button labels) lives in **GHL custom values**, not env vars. See [`docs/replication/ghl-onboarding-runbook.md`](docs/replication/ghl-onboarding-runbook.md) for the full custom-value inventory.

### Running locally during development

```bash
npm install
cp .env.example .env       # fill in PIT, location ID, signing keys
npm run dev                # http://localhost:4321
npm test                   # vitest unit tests
npx playwright test        # e2e (requires dev server running)
npm run check              # Astro + TypeScript typecheck
npm run build              # production build into dist/
```

### Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Phase 0 halts on PIT 401 | PIT expired or wrong scopes | Rotate in GHL → Settings → Private Integrations; re-export `GHL_PIT_TOKEN` |
| Phase 2 location drafts >40% word overlap | Intake §6 cities too thin on landmarks | Add specific landmarks + demographic notes; rerun phase 2 |
| Phase 3 TypeScript check fails | Intake data shape doesn't match `src/content/*` types | Fix the data — **do not loosen the types** |
| Phase 4 `onboard:ghl discover` reports MISSING | Operator phase 4b UI work incomplete | Print missing items; instructor finishes UI work; rerun `discover` |
| Phase 6 build fails on `sharp` import | npm install didn't pick it up | `npm install sharp --save-dev` and rebuild |
| Phase 7 `/api/health/ghl` reports missing CFs/CVs after operator says UI done | Name mismatch (case-sensitive) | Compare missing item against `config/ghl-schema.ts` — names must match exactly |
| Webhook returns 401 in prod | `GHL_WEBHOOK_SECRET` mismatch | Rotate value in BOTH the GHL workflow action header AND Vercel env, redeploy |
| Site redirect-loops between apex and www | Conflicting redirect in `vercel.json` | Remove from `vercel.json`; Vercel dashboard handles this canonically |
| Booking form returns RATE_LIMITED on first try | In-memory rate-limiter cold start | Wait 30s and retry (architectural fix tracked in design spec §10) |

For GHL-specific reverse-engineering of workflow/trigger/email APIs, see [`docs/replication/ghl-workflow-build-from-scratch.md`](docs/replication/ghl-workflow-build-from-scratch.md) and [`docs/replication/ghl-api-access-methods.md`](docs/replication/ghl-api-access-methods.md).

---

## C — For AI Sessions

You've been handed this repo and asked to replicate it for a new client. Your single instruction is to execute the procedure at [`docs/replication/REPLICATE.md`](docs/replication/REPLICATE.md).

Read in this order:

1. **`docs/replication/REPLICATE.md`** — the 9-phase procedure with exact commands, acceptance criteria, and halt-on-fail rules. This is your master script.
2. **`CLIENT_INTAKE.md`** (provided by the operator) — the single source of truth for client-specific values. Halt with a precise error if any REQUIRED field is missing. Never substitute.
3. **`config/ghl-schema.ts`** — source of truth for pipeline names, stages, custom fields, custom values, and workflows. Used by Phase 4 to generate the UI checklist and by Phase 7 to verify health.

Deep-dive references (follow links from REPLICATE.md when needed):

- [`docs/replication/ghl-api-integration-spec.md`](docs/replication/ghl-api-integration-spec.md) — public GHL API contract
- [`docs/replication/ghl-api-access-methods.md`](docs/replication/ghl-api-access-methods.md) — PIT auth, scopes, Conversation AI endpoints
- [`docs/replication/ghl-workflow-build-from-scratch.md`](docs/replication/ghl-workflow-build-from-scratch.md) — internal-backend workflow build (when you need to build workflows the public API can't reach)
- [`docs/replication/ghl-onboarding-runbook.md`](docs/replication/ghl-onboarding-runbook.md) — long-form human-readable runbook
- [`docs/replication/ghl-dashboard-build-guide.md`](docs/replication/ghl-dashboard-build-guide.md) — UI build steps for the operator's phase 4b
- [`docs/replication/launch-checklist.md`](docs/replication/launch-checklist.md) — production go-live items

### Hard rules you must follow

These are repeated from §B (and from REPLICATE.md) because they're absolute:

1. **No silent invention.** Halt on missing inputs.
2. **No production promotion.** Stop at preview.
3. **Configurable values → GHL custom values; secrets + IDs → env vars.** Don't put config in env.
4. **Vercel dashboard handles apex/www.** Don't add to `vercel.json`.
5. **Idempotent.** Check before create.
6. **Halt on fail.** Don't advance past a failed phase.

### Output you produce

- AI-drafted content in `drafts/` (gitignored — operator reviews, you do NOT commit)
- Updated `src/content/*`, `src/data/*`, `src/pages/*` (committed)
- `.env.client.local` with discovered GHL IDs (gitignored — used to populate Vercel env)
- `HANDOFF.md` at the new repo root (committed, summarizes what's done and what the operator still owes)

---

# Reference

| Topic | File |
|---|---|
| Architecture spec | [`docs/superpowers/specs/2026-05-27-ai-replication-spec-design.md`](docs/superpowers/specs/2026-05-27-ai-replication-spec-design.md) |
| Replication procedure | [`docs/replication/REPLICATE.md`](docs/replication/REPLICATE.md) |
| Client intake template | [`docs/replication/CLIENT_INTAKE.template.md`](docs/replication/CLIENT_INTAKE.template.md) |
| Intake validator | `npm run validate:intake CLIENT_INTAKE.md` |
| GHL schema (source of truth) | [`config/ghl-schema.ts`](config/ghl-schema.ts) |
| GHL public API contract | [`docs/replication/ghl-api-integration-spec.md`](docs/replication/ghl-api-integration-spec.md) |
| GHL auth methods | [`docs/replication/ghl-api-access-methods.md`](docs/replication/ghl-api-access-methods.md) |
| GHL workflow build (reverse-engineered) | [`docs/replication/ghl-workflow-build-from-scratch.md`](docs/replication/ghl-workflow-build-from-scratch.md) |
| GHL onboarding runbook | [`docs/replication/ghl-onboarding-runbook.md`](docs/replication/ghl-onboarding-runbook.md) |
| GHL dashboard build guide | [`docs/replication/ghl-dashboard-build-guide.md`](docs/replication/ghl-dashboard-build-guide.md) |
| Launch checklist | [`docs/replication/launch-checklist.md`](docs/replication/launch-checklist.md) |
| Intro campaign GHL setup | [`docs/replication/intro-campaign-setup.md`](docs/replication/intro-campaign-setup.md) |
| Back-to-the-Mats GHL setup | [`docs/replication/btm-campaign-setup.md`](docs/replication/btm-campaign-setup.md) |
| Chat widget bot content | [`docs/replication/ghl-chat-widget-bot-content.md`](docs/replication/ghl-chat-widget-bot-content.md) |
| SMS bot (Alex) prompt | [`docs/replication/sms-bot-prompt-updated.md`](docs/replication/sms-bot-prompt-updated.md) |
| SMS bot pipeline orchestration | [`docs/replication/sms-bot-pipeline-orchestration.md`](docs/replication/sms-bot-pipeline-orchestration.md) |
| Referral tracking | [`docs/replication/ai-referral-tracking.md`](docs/replication/ai-referral-tracking.md) |
| Image asset inventory | [`docs/replication/images-needed.md`](docs/replication/images-needed.md) |

---

## Getting help

- File an issue against this repo with the phase number that halted + the exact error message
- Email: `tech@localcraze.com`
- Bring the AI session into the issue — it has full repo context and can usually unblock from the error message alone
