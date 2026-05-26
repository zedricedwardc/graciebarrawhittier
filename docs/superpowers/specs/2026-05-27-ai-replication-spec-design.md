# AI Replication Spec — Design

**Status:** Approved (2026-05-27)
**Owner:** tech@localcraze.com
**Goal:** Enable a future AI session to replicate the entire Gracie Barra Whittier build (site + API + GHL automation) for a new client, ending at a staging-ready preview deploy with a written handoff for the operator to take the rest of the way to production.

---

## 1. Problem

The codebase is already client-agnostic by design — GHL is referenced through a declarative schema, the site uses tokenized colors, content lives in typed `src/content/*` and `src/data/*` files, and `scripts/onboard-client.ts` automates the API-creatable portions of GHL provisioning. The reproducibility primitive exists.

What's missing is an **AI-readable orchestrator** that:

- Tells a fresh AI session what to do, in what order, with what tools
- Defines the per-client data the AI needs as input (and what shape it takes)
- Generates a per-client handoff document so the operator can complete the manual gaps (GHL UI clicks, real photos, real testimonials, DNS)
- Plays nicely with the existing deep-dive runbooks (`docs/ghl-*.md`) rather than duplicating them

This spec defines that orchestrator layer.

## 2. Non-goals

- **No greenfield rebuild.** AI forks this repo as a template; it does not regenerate the site from scratch.
- **No autonomous production deploy.** AI stops at a staging preview. Operator (or a separate human-approved step) promotes to production.
- **No replacement of existing docs.** The long-form GHL runbooks and the onboard script remain authoritative deep-dive references; the new docs orchestrate around them.
- **No content production beyond first draft.** AI drafts copy from intake hints; operator/client approves and may rewrite before publication.
- **No replacement of `scripts/onboard-client.ts`.** AI invokes it.

## 3. Definition of done (per client replication)

When the AI finishes executing `REPLICATE.md` against a filled-in `CLIENT_INTAKE.md`:

1. A new git repo exists with brand, content, env wiring, and deploy config adapted to the client.
2. A Vercel preview deployment is live and `/api/health/ghl` returns 200 for all API-creatable schema items.
3. The GHL sub-account has all API-creatable assets provisioned (custom values, tags).
4. A `HANDOFF.md` exists in the repo listing: what was done, what the operator must still do (GHL UI work, real content, DNS), and the production go-live steps.
5. `npm test` passes (unit + e2e where possible without live GHL).

Anything blocking these criteria fails the corresponding phase and the AI halts with a clear error — it does not invent missing data.

## 4. Artifact shape

Two checked-in template files + one generated-per-client output:

```
NEW (top of stack, AI reads):
  REPLICATE.md                  — AI-readable procedure (9 phases)
  CLIENT_INTAKE.template.md     — per-client data shape

GENERATED (per client, AI writes):
  HANDOFF.md                    — receipt of work + operator TODOs

EXISTING (deep-dive references, AI follows links when needed):
  docs/ghl-onboarding-runbook.md
  docs/ghl-setup-master-checklist.md
  docs/ghl-api-integration-spec.md
  docs/ghl-automation-plan.md
  docs/ghl-dashboard-build-guide.md
  docs/launch-checklist.md
  scripts/onboard-client.ts
  config/ghl-schema.ts          — source of truth for GHL shape
```

No migration of existing docs. The new docs orchestrate; the existing docs explain.

## 5. REPLICATE.md — phase breakdown

The AI executes phases 0 → 8 in order. Each phase has explicit **acceptance criteria** (commands to run + expected output). The AI must not advance past a phase whose criteria failed; it surfaces the failure and halts.

| Phase | What AI does | Operator checkpoint |
|---|---|---|
| **0. Preflight** | Validate `CLIENT_INTAKE.md` is complete: every required field present, asset URLs return 200, `GHL_PIT_TOKEN` works against the sub-account, Vercel CLI is authed, domain registrar access confirmed (or operator flagged "I'll handle DNS"). | None — AI proceeds if green, halts if red |
| **1. Repo fork & brand swap** | Clone template repo into the new client repo. Replace logo files (`public/logo/`), swap color values in `src/styles/tokens.css`, update `public/favicon.svg`, regenerate OG images via `scripts/og-image-*.mjs` (now wired into a `prebuild` step). Update `package.json` `name` field and `astro.config.mjs` `site` URL. | Operator reviews visual diff at end of phase |
| **2. Content production** | AI drafts: per-location SEO copy (one per city in intake §6, each 150+ unique words using landmarks + demographics), FAQ overrides from brand voice + program list, instructor bios from raw credentials, hero copy variants, per-location OG image briefs. All drafts written to `drafts/<phase>/` for operator review. AI does NOT swap into source files yet. | Operator reviews/edits drafts before phase 3 |
| **3. Content swap** | Apply approved drafts. Update `src/content/{nap,instructors,programs,faqs,adults-faqs,kids-faqs,reviews}.ts` and `src/data/{programs,schedule,blackouts}.ts`. Adapt or generate location pages from intake §6. Replace placeholder testimonial copy in kids page. | None |
| **4. GHL provisioning** | Run `scripts/onboard-client.ts` against the new sub-account. Capture and structure the printed UI checklist (for non-API-creatable pipelines/stages/custom fields/workflows) into a section of the generated HANDOFF.md. Update intake §9 with any generated IDs/URLs the script produces. | Operator does UI clicks in GHL between phase 4 and re-running the health check in phase 7 |
| **5. Env + secrets wiring** | Generate `.env.production` from intake values + freshly-random 32-char `GHL_WEBHOOK_SECRET`, `CANCEL_SIGNING_KEY`, `REBOOK_SIGNING_KEY`. Push to Vercel via `vercel env add` for production + preview environments. Verify with `vercel env ls`. | None |
| **6. Deploy preview** | `vercel deploy` (preview URL). Wait for build to finish. Capture the preview URL. | None |
| **7. Verification** | Curl `<preview-url>/api/health/ghl` — must return 200 with all schema items resolved (API-creatable parts; UI parts will fail until operator does phase 4 follow-up). Smoke-test the opt-in form (submit a synthetic lead with `source=preflight`, confirm in GHL, then clean up via existing audit script). Run `npm test`. | AI reports red/green per check |
| **8. Handoff generation** | Write `HANDOFF.md` (structure in §7 below). Commit and push. Print preview URL + handoff URL. | Operator owns from here |

### Phase-level rules the AI must follow

- **Idempotency.** Running phases 0–7 a second time on the same repo must not duplicate provisioned assets. AI checks for existing state before creating.
- **No silent invention.** If a required intake field is missing, halt with a precise error — never substitute a placeholder.
- **No production promotion.** AI never runs `vercel promote --prod` or points DNS. That's operator territory.
- **Respect project memory:** Vercel dashboard handles apex/www canonicalization; do NOT add a conflicting redirect in `vercel.json`. Env vars are reserved for secrets + GHL resource IDs; configurable values go in GHL custom values.
- **PII discipline.** Any logging during replication redacts contact PII the same way the runtime code does (SHA-256 email prefix).

## 6. CLIENT_INTAKE.template.md — section schema

The intake doc is the operator's single source of truth for client-specific values. AI's preflight (phase 0) validates every required field is present and every asset URL returns 200. Fields marked optional may be omitted; AI fills with documented defaults.

| § | Section | Required fields | Purpose |
|---|---|---|---|
| 1 | **Identity** | legal name, brand name, URL slug, domain, (tagline) | Used in package.json, astro.config.mjs site URL, OG images, schema |
| 2 | **NAP** | street, city, state, zip, phone (display + tel format), email, hours per day, Google Maps URL, Google Business Profile place ID | `src/content/nap.ts`, footer, contact page, LocalBusiness schema, reviews import |
| 3 | **Brand** | logo (SVG + horizontal/vertical/icon variants), favicon (SVG/PNG), primary/secondary/accent hex, (font choice — Inter default), brand voice (3 adjectives) | `src/styles/tokens.css`, `public/logo/`, `public/favicon.svg`, AI copy tone calibration |
| 4 | **Programs offered** | Kids tiers enabled (Tiny / Little / Juniors), Adults tiers (Fundamentals / All-levels), BTM enabled (y/n + price/deadline), per-program age range, class duration, schedule | `src/data/programs.ts`, `src/data/schedule.ts`, program pages |
| 5 | **Instructors** | per-instructor: name, title, belt rank, lineage, years training, certifications, bio raw notes (AI drafts final), photo URL | `src/content/instructors.ts`, SchemaPerson, instructor pages |
| 6 | **Locations served** | per-city: name, 2-3 landmarks, demographic note, distance/commute to studio | Drives AI-generated unique 150+ word SEO landing pages (one per city) |
| 7 | **Reviews** | Google Place ID (preferred) OR list of {name, role, quote, date} | `src/content/reviews.ts`, SchemaLocalBusiness aggregateRating |
| 8 | **Offer / promotions** | free trial details (# classes, "no contract" copy, what's included), BTM offer (price/mo, deadline window in days), (seasonal promo) | Offer page, hero copy, CTA microcopy |
| 9 | **GHL workspace** | sub-account ID, PIT, (pre-existing pipelines — usually no), calendar IDs per program (filled after phase 4 UI work), webhook URL base (filled after phase 6) | Env vars, runtime config |
| 10 | **Deploy** | Vercel team/org, project name preference, production domain, DNS access (or "operator handles"), notification email | Vercel CLI, env wiring, handoff DNS instructions |
| 11 | **Legal / compliance** | waiver text (template OR custom), photo release policy (template OR custom), studio-specific safety policies (mat hygiene, background checks) | `src/pages/{privacy,terms}.astro` |
| 12 | **Assets** | studio interior photos (5+), class-in-action photos (kids + adults), instructor headshots (referenced from §5), (belt-ceremony / achievement photos) | `public/images/`, all photo references in pages |
| 13 | **SMS / email overrides (optional)** | custom welcome SMS, custom confirmation subject/body | GHL workflow content |

Each section in the template will have inline instructions ("FILL THIS IN" / "AI WILL DRAFT") and example values from the Gracie Barra Whittier original as concrete reference.

## 7. HANDOFF.md — generated structure

Written by the AI at end of phase 8, committed and pushed. Three buckets so the operator immediately knows what's actionable.

```markdown
# HANDOFF — <Studio Name>
Generated: <ISO timestamp>
Preview: <vercel preview URL>
Repo: <new repo URL>

## ✅ Completed
- Repo, brand, content, GHL API parts, env vars, deploy, tests
  (each line names what was done with a verifiable artifact)

## ⏳ Operator must complete BEFORE production
### GHL UI work (cannot be API-automated)
- [ ] Create pipelines (checklist below, from config/ghl-schema.ts)
- [ ] Create contact + opportunity custom fields (checklist)
- [ ] Create workflows + paste each webhook URL into the corresponding action (checklist)
- [ ] Re-run /api/health/ghl until green

### Content the client still owes
- [ ] Real studio photos for: <list of pages still on stock>
- [ ] Real parent testimonials (currently AI-drafted with disclaimer)
- [ ] Final instructor bios approved (AI drafts in drafts/ for review)
- [ ] Belt-ceremony / class-in-action video (optional, high trust impact)

### Domain + DNS
- [ ] Point <domain> to Vercel (instructions inline)
- [ ] Vercel dashboard: add custom domain, verify SSL
- [ ] Confirm apex/www canonicalization in Vercel dashboard (DO NOT add redirect to vercel.json)

## ⚠️ Warnings raised during replication
<preflight soft-fails, deferred decisions, anything the AI couldn't verify>

## 🚀 Going to production
1. Confirm all "Operator must complete" items checked
2. vercel promote <preview-url> --prod
3. Verify https://<domain>/api/health/ghl returns 200
4. Send first real lead through the form, confirm in GHL
5. Update CLIENT_INTAKE.md §9 with final calendar IDs

## 📚 Reference
- Architecture overview: <link>
- GHL schema (source of truth): config/ghl-schema.ts
- Deep dives: docs/ghl-api-integration-spec.md, docs/ghl-onboarding-runbook.md
- Drafted content (review before publishing): drafts/

## 📞 Troubleshooting
- Webhook 401s → GHL_WEBHOOK_SECRET mismatch (rotate both sides)
- Rate-limit issues on cold start → see architecture notes on kv adapter migration
- /api/health/ghl 5xx → check sub-account PIT and pipeline names match schema
```

## 8. How this slots into the existing doc landscape

The new docs are an orchestration layer that **invokes** existing assets rather than replacing them:

- `REPLICATE.md` phase 4 → invokes `scripts/onboard-client.ts`, links to `docs/ghl-onboarding-runbook.md` for failure-mode deep dive.
- `REPLICATE.md` phase 3 → reads `config/ghl-schema.ts` as data source for what custom fields/pipelines exist.
- `HANDOFF.md` GHL UI checklist → derived from `config/ghl-schema.ts` (not copied — re-derived each time from current schema, so it never drifts).
- `HANDOFF.md` production runbook section → links to `docs/launch-checklist.md` for the long form.

No existing doc is rewritten. No existing automation is duplicated.

## 9. Risks & mitigations

| Risk | Mitigation |
|---|---|
| AI invents data when intake field is missing | Phase 0 preflight halts on any missing required field. AI's prompt explicitly forbids substitution. |
| GHL UI checklist drifts from schema | Generated fresh each run from `config/ghl-schema.ts`, never hardcoded in HANDOFF.md |
| Operator pushes to prod before phase 4b UI work done | HANDOFF.md "Going to production" §1 gates on "all operator items checked"; `/api/health/ghl` will fail until UI work complete |
| Idempotency failure on re-run | Phase-level rule: each phase checks for existing state before creating. Documented in REPLICATE.md per-phase. |
| Secrets logged during replication | PII discipline rule in REPLICATE.md; AI must redact emails/PIT in any log/handoff output |
| Per-location pages still thin | Phase 2 explicitly requires AI to use landmarks + demographics from intake §6 to produce 150+ unique words per city. AI's draft check counts words and rejects boilerplate. |
| Asset URL rot between intake and execution | Phase 0 fetches every asset URL and verifies 200; halts if any fail |

## 10. Open questions deferred to implementation

- **Intake doc format** — Markdown with structured sections (current plan) vs. YAML frontmatter + Markdown body. To be settled when writing the template.
- **Drafts review mechanism** — Does the operator review `drafts/` in their editor, or does AI generate a single review document? To be settled when implementing phase 2.
- **Multi-tenant repo strategy** — One forked repo per client (current plan) vs. a monorepo with `clients/<slug>/` directories. Out of scope for this spec; revisit if you onboard >5 clients.
- **GHL UI automation via Playwright** — Could phase 4b be partially automated by driving GHL's UI? Out of scope for v1; potential follow-on.

## 11. Success metric

A fresh AI session (no prior context of this repo) given:
- The template repo
- A filled `CLIENT_INTAKE.md`
- `REPLICATE.md`

…produces a working staging preview and a complete `HANDOFF.md` in under one continuous session, with zero substituted/invented values, and with all halts being precise and actionable.