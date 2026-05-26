# AI Replication Spec Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the AI-readable orchestrator layer (REPLICATE.md + CLIENT_INTAKE.template.md + supporting validator + prebuild wiring) that lets a future AI session fork this template repo and stand up a staging-ready instance for a new client.

**Architecture:** Two new doc templates checked into `docs/replication/`, an `intake-validator.ts` script for phase-0 preflight, OG image generation wired into `prebuild`, `drafts/` added to `.gitignore`, and an updated top-level README pointing at the replication entry point. No existing docs are rewritten; everything orchestrates around existing assets (`scripts/onboard-client.ts`, `config/ghl-schema.ts`, `docs/ghl-*.md`).

**Tech Stack:** Markdown (docs), TypeScript + Vitest (validator script), Node `sharp` for OG image generation, existing `tsx` runner. No new runtime deps in the site bundle.

**Spec:** [docs/superpowers/specs/2026-05-27-ai-replication-spec-design.md](../specs/2026-05-27-ai-replication-spec-design.md)

---

## File Structure

**Create:**
- `docs/replication/README.md` — AI orientation entry point (what to read in what order)
- `docs/replication/REPLICATE.md` — 9-phase procedure
- `docs/replication/CLIENT_INTAKE.template.md` — 13-section intake template
- `scripts/intake-validator.ts` — preflight validator (parses intake, checks required fields, fetches asset URLs)
- `scripts/intake-validator.test.ts` — unit tests

**Modify:**
- `.gitignore` — add `drafts/`
- `package.json` — add `sharp` to devDependencies, add `prebuild` script, add `validate:intake` script
- `README.md` — replace default Astro template content with project orientation + pointer to replication docs

**Untouched (referenced but not modified):**
- `scripts/onboard-client.ts`, `config/ghl-schema.ts`, all `docs/ghl-*.md`, `docs/launch-checklist.md`

---

## Task 1: Scaffold replication directory + ignore drafts/

**Files:**
- Create: `docs/replication/README.md`
- Modify: `.gitignore`

- [ ] **Step 1: Create the orientation README**

Write `docs/replication/README.md`:

```markdown
# Client Replication — AI orientation

This directory holds the AI-readable orchestrator for replicating this
template into a new client instance.

## If you are an AI session

Read in this order:
1. `REPLICATE.md` — the 9-phase procedure you execute
2. `CLIENT_INTAKE.template.md` — the data shape (the operator gives you a filled copy)
3. `../../config/ghl-schema.ts` — source of truth for GHL pipelines/stages/CFs/workflows

Deep-dive references (follow links from REPLICATE.md when needed):
- `../ghl-api-integration-spec.md` — GHL API contract
- `../ghl-onboarding-runbook.md` — long-form runbook (human-readable)
- `../ghl-setup-master-checklist.md` — checklist format
- `../ghl-automation-plan.md` — workflow design
- `../ghl-dashboard-build-guide.md` — UI build steps
- `../launch-checklist.md` — production go-live items

Generated artifacts (per-client):
- `drafts/` — AI-drafted copy awaiting operator review (gitignored)
- `HANDOFF.md` — written at end of phase 8 to the new client repo root

## If you are an operator

1. Copy `CLIENT_INTAKE.template.md` to `CLIENT_INTAKE.md` and fill it in
2. Run `npm run validate:intake CLIENT_INTAKE.md` to preflight-check
3. Hand the filled intake and this repo to a fresh AI session along with
   the instruction: "execute docs/replication/REPLICATE.md"
4. Review AI-drafted content in `drafts/` between phases 2 and 3
5. After AI finishes phase 8, work through `HANDOFF.md`
```

- [ ] **Step 2: Add drafts/ to .gitignore**

Append to `.gitignore`:

```
# AI-drafted content awaiting operator review (per-client, not template)
drafts/

# Per-client intake (template stays; filled copies stay local)
CLIENT_INTAKE.md
```

- [ ] **Step 3: Commit**

```bash
git add docs/replication/README.md .gitignore
git commit -m "feat(replication): scaffold docs/replication/ with orientation README"
```

---

## Task 2: CLIENT_INTAKE.template.md — sections 1-4

**Files:**
- Create: `docs/replication/CLIENT_INTAKE.template.md`

Section content shown verbatim. Every required field is marked `REQUIRED:`; optional fields are marked `(optional)`. Example values use real Gracie Barra Whittier data from `src/content/nap.ts` so the operator has a working reference.

- [ ] **Step 1: Write the header + sections 1-4**

Write `docs/replication/CLIENT_INTAKE.template.md`:

```markdown
# Client Intake — <Studio Name>

> **For the operator:** Fill every `REQUIRED:` field. Replace example values with this client's real values. Mark sections as `[DONE]` when you're confident.
> **For the AI:** Treat this as the single source of truth for client-specific values. Halt with a precise error if any REQUIRED field is missing — never substitute.

---

## 1. Identity

- **REQUIRED:** Legal business name — e.g., `Gracie Barra Whittier LLC`
- **REQUIRED:** Brand name (display) — e.g., `Gracie Barra Whittier`
- **REQUIRED:** URL slug (lowercase, hyphens) — e.g., `graciebarra-whittier`
- **REQUIRED:** Production domain — e.g., `graciebarrawhittier.com`
- (optional) Tagline — e.g., `Authentic Brazilian Jiu-Jitsu in Whittier`

## 2. NAP (verbatim — used in schema, footer, contact, every page)

- **REQUIRED:** Street address + suite — e.g., `13595 Whittier Blvd. #104`
- **REQUIRED:** City — e.g., `Whittier`
- **REQUIRED:** State (2-letter) — e.g., `CA`
- **REQUIRED:** Zip — e.g., `90605`
- **REQUIRED:** Country (2-letter) — e.g., `US`
- **REQUIRED:** Phone display — e.g., `(562) 640-1400`
- **REQUIRED:** Phone tel: format — e.g., `+15626401400`
- **REQUIRED:** Public email — e.g., `info@gbwhittier.com`
- **REQUIRED:** Latitude — e.g., `33.9385`
- **REQUIRED:** Longitude — e.g., `-118.0149`
- **REQUIRED:** Google Maps URL
- **REQUIRED:** Google Business Profile place ID (for reviews import)
- **REQUIRED:** Hours per day — list `{ days: [...], opens: 'HH:MM', closes: 'HH:MM' }` blocks
- (optional) Instagram URL
- (optional) Facebook URL
- (optional) Yelp URL
- (optional) Price range indicator — default `$$`

## 3. Brand

- **REQUIRED:** Logo SVG — horizontal/wide variant (URL or attached)
- **REQUIRED:** Logo SVG — vertical/stacked variant (URL or attached)
- **REQUIRED:** Logo SVG — icon-only variant (URL or attached)
- **REQUIRED:** Favicon (SVG or PNG ≥192px)
- **REQUIRED:** Primary color hex — e.g., `#1b2a5e` (GB navy)
- **REQUIRED:** Secondary color hex — e.g., `#cc2200` (GB red)
- **REQUIRED:** Accent color hex — e.g., `#ef9f27` (GB gold)
- (optional) Font family — default `Inter`
- **REQUIRED:** Brand voice — pick 3 adjectives — e.g., `welcoming, disciplined, family-first`

## 4. Programs offered

For each program tier, mark **enabled: yes/no** and fill the details if yes.

### Kids
- **Tiny Champions** (ages 3-4) — enabled: REQUIRED yes/no
  - Class duration (min): REQUIRED if yes
  - Schedule blocks: REQUIRED if yes — list `{ days: [...], start: 'HH:MM', duration: N }`
- **Little Champions** (ages 5-6) — enabled: REQUIRED yes/no, (details if yes)
- **Juniors** (ages 7-12) — enabled: REQUIRED yes/no, (details if yes)
- **Teens** (ages 13-15) — enabled: REQUIRED yes/no, (details if yes)

### Adults (16+)
- **Fundamentals** — enabled: REQUIRED yes/no, (details if yes)
- **All-Levels / Gi** — enabled: REQUIRED yes/no, (details if yes)
- **No-Gi** — enabled: REQUIRED yes/no, (details if yes)
- **Advanced** — enabled: REQUIRED yes/no, (details if yes)

### Back-to-the-Mats (reactivation campaign)
- **Enabled** — REQUIRED yes/no
- If yes:
  - Monthly price — e.g., `$97/mo`
  - Deadline window in days — e.g., `60`

### Blackout dates
- (optional) Dates to mark unavailable for booking — list `YYYY-MM-DD`
```

- [ ] **Step 2: Verify the file parses as valid Markdown**

Run: `npx --yes markdown-link-check docs/replication/CLIENT_INTAKE.template.md || true`
(Tool warnings on placeholder URLs are fine; we're verifying the file is well-formed.)

- [ ] **Step 3: Commit**

```bash
git add docs/replication/CLIENT_INTAKE.template.md
git commit -m "feat(replication): intake template sections 1-4 (identity, NAP, brand, programs)"
```

---

## Task 3: CLIENT_INTAKE.template.md — sections 5-8

**Files:**
- Modify: `docs/replication/CLIENT_INTAKE.template.md` (append)

- [ ] **Step 1: Append sections 5-8**

Append to `docs/replication/CLIENT_INTAKE.template.md`:

```markdown

## 5. Instructors

For each instructor, fill the block. The AI will draft a polished bio from `bioNotes`; you'll review in `drafts/` before phase 3.

- **Name** — REQUIRED
- **Title** — REQUIRED — e.g., `Head Instructor`, `Program Director`, `Professor`
- **Belt rank** — REQUIRED — e.g., `Black Belt — 2nd Degree`
- **Lineage** — REQUIRED — who trained them — e.g., `Master Carlos Gracie Jr. → Prof. X → Prof. Y`
- **Years training** — REQUIRED — e.g., `18`
- **Years teaching** — REQUIRED — e.g., `9`
- **Certifications** — REQUIRED — list, e.g., `Gracie Barra Certified Instructor`, `CPR/First Aid (current)`, `IBJJF Referee`
- **bioNotes** — REQUIRED — raw notes (3-5 sentences in any form; AI drafts the final bio)
- **Photo URL** — REQUIRED — headshot, square 1:1, ≥600×600px

Repeat for each instructor (minimum 1).

## 6. Locations served (drives SEO landing pages)

For EACH neighboring city you want to rank for, fill the block. The AI generates a unique 150+ word landing page per city using these inputs. Skip cities you don't want to target.

- **City name** — REQUIRED — e.g., `La Habra`
- **Landmarks** — REQUIRED — 2-3 specific places — e.g., `La Habra Recreation Park, La Habra Civic Center, Hacienda Heights border`
- **Demographic note** — REQUIRED — one line about the community — e.g., `Family-heavy, Spanish-speaking households common`
- **Distance to studio** — REQUIRED — e.g., `4 miles, ~10 minute drive`
- (optional) Local testimonial — quote from a student/parent from this city — strongly recommended for trust

Repeat for each city (3-5 cities recommended; doorway-page risk if you skimp on uniqueness).

## 7. Reviews

Pick ONE of these two options:

### Option A (preferred): Google Business Profile
- **REQUIRED:** Google Place ID — AI fetches the latest reviews via the public profile

### Option B: Manual list
For each review: name, role (parent/student/adult), quote, date (`YYYY-MM-DD`)

Minimum: 6 reviews, mix of parent + adult-student voices, span the last 12 months.

## 8. Offer / promotions

### Free trial offer (primary funnel)
- **REQUIRED:** Number of free classes — e.g., `3`
- **REQUIRED:** Risk-reducer copy — e.g., `No contracts. No pressure. Free uniform rental included.`
- **REQUIRED:** What's included — e.g., `3 trial classes + free uniform rental + intro orientation`

### Back-to-the-Mats offer (only if §4 BTM enabled)
- Already provided in §4 (price + deadline window)

### Seasonal promotion
- (optional) Promo name + dates + offer details — leave blank for most clients
```

- [ ] **Step 2: Commit**

```bash
git add docs/replication/CLIENT_INTAKE.template.md
git commit -m "feat(replication): intake template sections 5-8 (instructors, locations, reviews, offer)"
```

---

## Task 4: CLIENT_INTAKE.template.md — sections 9-13

**Files:**
- Modify: `docs/replication/CLIENT_INTAKE.template.md` (append)

- [ ] **Step 1: Append sections 9-13**

Append:

```markdown

## 9. GHL workspace

Fields marked `(filled later)` will be populated by the AI during phase 4 — leave blank initially.

- **REQUIRED:** Sub-account ID (Location ID) — e.g., `abc123XYZ`
- **REQUIRED:** Private Integration Token (PIT) — keep in a secrets manager; paste here for AI consumption
- **REQUIRED:** Whether pipelines already exist in this sub-account — yes/no (almost always no — fresh sub-accounts are recommended)
- (filled later by AI) Calendar IDs per program — populated by `npm run onboard:ghl discover` after operator does UI work
- (filled later by AI) Webhook URL base — populated after phase 6 deploy

## 10. Deploy

- **REQUIRED:** Vercel team/org name — e.g., `localcraze`
- **REQUIRED:** Vercel project name preference — e.g., `gb-whittier`
- **REQUIRED:** Production domain — same as §1
- **REQUIRED:** DNS access — answer ONE:
  - `operator-handles` — operator will do DNS swap themselves; HANDOFF.md gives instructions
  - `registrar-credentials-provided` — credentials supplied separately (do NOT paste here)
- **REQUIRED:** Notification email for deploy events — e.g., `tech@localcraze.com`

## 11. Legal / compliance

For each: choose `template` (use the GB Whittier defaults) or paste custom text.

- **REQUIRED:** Waiver text — `template` or `<custom>`
- **REQUIRED:** Photo release policy — `template` or `<custom>`
- **REQUIRED:** Safety policies — choose subset from defaults, or paste custom:
  - Mat hygiene (cleaned daily, etc.)
  - Background checks on instructors
  - Health screening for new students
  - Injury reporting protocol

## 12. Assets (URLs to studio photos)

Every URL must be reachable (returns HTTP 200). AI's phase-0 preflight verifies this and halts if any fail.

- **REQUIRED:** Studio interior photos — minimum 5, ≥1920×1080
- **REQUIRED:** Class-in-action photos — kids, minimum 3, ≥1920×1080
- **REQUIRED:** Class-in-action photos — adults, minimum 3, ≥1920×1080
- **REQUIRED:** Instructor headshots — referenced from §5 by name (must match instructor names)
- (optional, high trust impact) Belt-ceremony / achievement photos
- (optional, high trust impact) Class walkthrough video (YouTube unlisted is fine)

## 13. SMS / email content overrides (optional)

Leave blank to use Gracie Barra Whittier defaults from the template.

- (optional) Custom welcome SMS body
- (optional) Custom booking-confirmation email subject
- (optional) Custom booking-confirmation email body
- (optional) Custom no-show follow-up SMS body
- (optional) Custom rebook-reminder SMS body

---

## Done?

Run the validator before handing to AI:

```bash
npm run validate:intake CLIENT_INTAKE.md
```

Expected output: `INTAKE VALID — N required fields present, M asset URLs reachable.`

Any error means: fix the listed issues before invoking AI. Do not skip — AI will halt on the same checks.
```

- [ ] **Step 2: Commit**

```bash
git add docs/replication/CLIENT_INTAKE.template.md
git commit -m "feat(replication): intake template sections 9-13 (GHL, deploy, legal, assets, SMS)"
```

---

## Task 5: REPLICATE.md — header + phases 0, 1, 2

**Files:**
- Create: `docs/replication/REPLICATE.md`

- [ ] **Step 1: Write header + table of contents + phase 0**

Write `docs/replication/REPLICATE.md`:

```markdown
# REPLICATE — AI-driven client replication procedure

> **Audience:** A fresh Claude (or equivalent) session with no prior context of this repo. You are forking this template to stand up a new client instance.

## Inputs you need before starting

1. A filled `CLIENT_INTAKE.md` (use `CLIENT_INTAKE.template.md` as the shape — see §6 of the design spec)
2. This repo cloned to a working directory you control
3. Tooling available: `git`, `node ≥22.12`, `npm`, `vercel` CLI (logged in), `tsx`
4. Env: `GHL_PIT_TOKEN` and `GHL_LOCATION_ID` for the NEW client's sub-account exported in your shell

## Hard rules (do not violate)

1. **No silent invention.** If a required intake field is missing or an asset URL returns non-200, halt with a precise error message naming the field/URL. Do not substitute.
2. **No production promotion.** You stop at a Vercel preview deployment. The operator promotes to production.
3. **Respect project memory:**
   - Vercel dashboard handles apex/www canonicalization — do NOT add a conflicting redirect in `vercel.json` (causes loop).
   - Env vars are reserved for secrets + GHL resource IDs. Configurable values go in GHL custom values, not env.
4. **PII discipline.** When logging during replication, redact emails as SHA-256-prefix (matches runtime code in `src/pages/api/book.ts`).
5. **Idempotency.** Re-running any phase must not duplicate created assets. Always check for existing state before creating.
6. **Halt-on-fail.** Do not advance past a phase whose acceptance criteria failed. Surface the failure and stop; operator decides whether to fix-and-retry or abort.

## Phases overview

| # | Phase | Operator checkpoint |
|---|---|---|
| 0 | Preflight | none — auto-proceeds if green |
| 1 | Repo fork + brand swap | operator reviews visual diff |
| 2 | Content production (AI drafts to `drafts/`) | operator reviews/edits drafts |
| 3 | Content swap | none |
| 4 | GHL provisioning | operator does UI clicks in GHL between 4a and 4c |
| 5 | Env + secrets wiring | none |
| 6 | Deploy preview | none |
| 7 | Verification | none — AI reports red/green |
| 8 | Handoff generation | operator owns from here |

---

## Phase 0 — Preflight

**Goal:** Fail fast on missing inputs before any side effects.

**Steps:**

1. Read `CLIENT_INTAKE.md` from the path the operator provided.
2. Run `npm run validate:intake CLIENT_INTAKE.md`. If it exits non-zero, print the validator's output verbatim and HALT.
3. Verify `GHL_PIT_TOKEN` works:
   ```bash
   curl -s -o /dev/null -w "%{http_code}" \
     -H "Authorization: Bearer $GHL_PIT_TOKEN" \
     -H "Version: 2021-07-28" \
     "https://services.leadconnectorhq.com/locations/$GHL_LOCATION_ID"
   ```
   Expected: `200`. Anything else → HALT with the actual code and a hint ("rotate PIT in GHL settings if 401").
4. Verify `vercel` CLI auth: `vercel whoami` — must print the operator's vercel username.
5. Verify the intake §10 Vercel team/org matches `vercel teams ls` output.

**Acceptance:** All 5 checks green. Otherwise HALT with the failing check named.

---

## Phase 1 — Repo fork + brand swap

**Goal:** A new git repo exists with this client's brand identity applied.

**Steps:**

1. Determine the new repo path from intake §1 `URL slug` — e.g., `../graciebarra-whittier`.
2. Create the new repo by copying this template (preserving git history is optional — recommend a fresh init):
   ```bash
   cp -R . ../<slug>
   cd ../<slug>
   rm -rf .git
   git init
   git add . && git commit -m "chore: initial fork from template"
   ```
3. Replace logo files in `public/logo/` with the intake §3 logo SVGs (horizontal, vertical, icon variants). Preserve filenames so references don't break.
4. Replace `public/favicon.svg` with the intake §3 favicon.
5. Edit `src/styles/tokens.css`: swap the three brand color values to intake §3 primary/secondary/accent. Leave token names unchanged.
6. Edit `astro.config.mjs`: replace the `site:` value with `https://<intake §1 production domain>`.
7. Edit `package.json`: update `name` to intake §1 URL slug.
8. Regenerate OG images:
   ```bash
   npm install         # picks up sharp from devDependencies (added in Task 10)
   npm run prebuild    # runs og-image-home/adults/kids scripts
   ```
9. Commit: `git commit -am "feat(brand): apply <client> brand identity"`

**Acceptance:**
- `git log` shows the brand commit
- `npm run build` succeeds
- Visual diff of `src/styles/tokens.css` and `public/logo/` looks right (operator reviews)

---

## Phase 2 — Content production (AI drafts to `drafts/`)

**Goal:** Produce first-draft copy for every client-specific text surface. Write to `drafts/` for operator review BEFORE applying.

**Steps:**

1. Create the drafts directory: `mkdir -p drafts/`
2. For each city in intake §6, draft a 150+ word unique landing page using the city's landmarks, demographics, distance, and (if present) local testimonial. Write to `drafts/locations/<city-slug>.md`. The draft must NOT repeat boilerplate from other cities — verify by running a word-overlap check; if >40% of words overlap with another draft, rewrite.
3. For each instructor in intake §5, draft a polished bio (~120 words) from their `bioNotes` + credentials. Lead with belt rank + lineage, then teaching philosophy. Write to `drafts/instructors/<name-slug>.md`.
4. Draft three hero copy variants for the home page (using brand voice from intake §3). Write to `drafts/hero-variants.md`. Operator picks one.
5. Draft FAQ overrides if intake §11 indicates studio-specific safety policies different from defaults. Write to `drafts/faqs/<category>.md`.
6. Draft the legal pages if intake §11 says `<custom>` for waiver or photo release. Write to `drafts/legal/<page>.md`.
7. Write a summary index `drafts/INDEX.md` listing every draft + a line on what the operator should check.
8. HALT and wait for operator signal "drafts approved" before advancing to phase 3. (Do NOT commit drafts — they're gitignored.)

**Acceptance:**
- Every required draft exists in `drafts/`
- `drafts/INDEX.md` lists all of them
- No two location drafts have >40% word overlap

---
```

- [ ] **Step 2: Commit**

```bash
git add docs/replication/REPLICATE.md
git commit -m "feat(replication): REPLICATE.md phases 0-2 (preflight, brand, content production)"
```

---

## Task 6: REPLICATE.md — phases 3, 4, 5

**Files:**
- Modify: `docs/replication/REPLICATE.md` (append)

- [ ] **Step 1: Append phases 3-5**

Append:

```markdown
## Phase 3 — Content swap

**Goal:** Apply approved drafts and direct-from-intake values into source files.

**Steps:**

1. Update `src/content/nap.ts`: replace every field with the intake §2 value. Preserve the exported type. Include the rating placeholder `{ average: 0, count: 0 }` if intake §7 used Option A (AI will refresh post-deploy from the Place ID); use real values if Option B.
2. Update `src/content/instructors.ts`: one entry per intake §5 instructor, body filled from the approved draft in `drafts/instructors/`.
3. Update `src/content/programs.ts` + `src/data/programs.ts` + `src/data/schedule.ts` from intake §4 (enabled programs only — remove entries for disabled tiers).
4. Update `src/data/blackouts.ts` from intake §4 blackout dates.
5. Update `src/content/reviews.ts`:
   - Option A (Place ID): leave the file's structure; populate from a one-off fetch you do now via the Google Business Profile public scrape pattern in `docs/ghl-onboarding-runbook.md` if documented, else leave a `// TODO: refresh post-deploy` comment AND add a HANDOFF note.
   - Option B (manual): one entry per intake §7 review.
6. Update location pages: for each intake §6 city, write `src/pages/bjj-<city-slug>.astro` using the existing `bjj-la-habra.astro` as a structural template and the approved draft from `drafts/locations/`. Delete location-page files for cities NOT in intake §6.
7. Update `src/content/{faqs,adults-faqs,kids-faqs}.ts` if drafts produced overrides; otherwise leave defaults.
8. Update `src/pages/{privacy,terms}.astro` if intake §11 chose `<custom>` for either policy.
9. Replace placeholder testimonial copy in `src/pages/kids-martial-arts.astro` (currently flagged at line ~193) with a real review from intake §7 OR a clear `<!-- placeholder: replace before launch -->` HTML comment that HANDOFF.md will surface.
10. Commit: `git commit -am "feat(content): apply <client> content from intake + drafts"`
11. Run `npm test` and `npm run check` — both must pass. If TypeScript errors arise, the data shape doesn't match — fix the data, do NOT loosen the types.

**Acceptance:**
- `git diff main src/content/ src/data/ src/pages/` shows the swap
- `npm test` passes
- `npm run check` passes (Astro typecheck)

---

## Phase 4 — GHL provisioning

**Goal:** New GHL sub-account has the schema in place; AI captures the UI-checklist for the operator.

This phase has three sub-steps with an operator gap between 4a and 4c.

### 4a. Generate UI checklist (AI runs)

1. Ensure `GHL_PIT_TOKEN` + `GHL_LOCATION_ID` are exported for the NEW client's sub-account (intake §9).
2. Run: `npm run onboard:ghl checklist`
3. Capture stdout to `drafts/ghl-ui-checklist.md`. This is the operator's UI to-do list.
4. HALT. Print to the operator: "I generated the GHL UI checklist at `drafts/ghl-ui-checklist.md`. Please complete the UI clicks in the GHL dashboard, then signal me with 'GHL UI done' to continue."

### 4b. Operator does UI clicks (operator runs)

This is human work — pipelines, stages, contact + opportunity custom fields, workflows. See `docs/ghl-dashboard-build-guide.md` for the long-form how-to.

### 4c. Discover IDs + provision API-creatable assets (AI runs)

1. Run: `npm run onboard:ghl discover`
   - This queries GHL and writes discovered pipeline/stage/CF IDs to `.env.client.local`
2. Run: `npm run onboard:ghl provision`
   - Idempotent. Creates custom values + base tags.
3. Read the generated `.env.client.local` and merge values into the intake `§9 (filled later)` fields so the intake stays accurate.
4. If either script reports any item as MISSING after operator's UI work, add it to the HANDOFF.md "Operator must complete" list with the exact missing item name.

**Acceptance:**
- `.env.client.local` exists with non-empty values for every required ID
- `onboard:ghl provision` exit code 0
- Any MISSING items captured for HANDOFF.md

---

## Phase 5 — Env + secrets wiring

**Goal:** Vercel project has every env var the runtime needs.

**Steps:**

1. Generate fresh secrets (32 random chars each):
   ```bash
   for var in GHL_WEBHOOK_SECRET CANCEL_SIGNING_KEY REBOOK_SIGNING_KEY; do
     val=$(node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))")
     echo "$var=$val" >> .env.production
   done
   ```
2. Merge `.env.client.local` (from phase 4c) into `.env.production` — IDs only, never the PIT.
3. Add the PIT separately: `echo "GHL_PIT_TOKEN=<value>" >> .env.production`
4. Add `GHL_LOCATION_ID` from intake §9.
5. Add any program-specific env vars referenced in `src/data/programs.ts` (e.g., calendar IDs).
6. Link the Vercel project: `vercel link --project <intake §10 project name> --yes`
7. Push every key from `.env.production` to Vercel for `production` and `preview` environments:
   ```bash
   while IFS='=' read -r key val; do
     [[ -z "$key" || "$key" == \#* ]] && continue
     printf '%s' "$val" | vercel env add "$key" production --force
     printf '%s' "$val" | vercel env add "$key" preview --force
   done < .env.production
   ```
8. Verify: `vercel env ls production` — every expected key present.
9. Delete `.env.production` (now safely in Vercel): `rm .env.production`
10. DO NOT commit `.env.client.local` or any `.env.*` file (already gitignored — verify nothing slipped through).

**Acceptance:**
- `vercel env ls production` shows every required key (compare against `src/lib/ghl.ts` and other `readEnv` calls in the codebase)
- `.env.production` no longer exists locally
- `git status` shows no `.env*` files staged

---
```

- [ ] **Step 2: Commit**

```bash
git add docs/replication/REPLICATE.md
git commit -m "feat(replication): REPLICATE.md phases 3-5 (content swap, GHL, env wiring)"
```

---

## Task 7: REPLICATE.md — phases 6, 7, 8 + HANDOFF template + troubleshooting

**Files:**
- Modify: `docs/replication/REPLICATE.md` (append)

- [ ] **Step 1: Append phases 6-8 + HANDOFF template + troubleshooting**

Append:

```markdown
## Phase 6 — Deploy preview

**Goal:** A live Vercel preview URL exists.

**Steps:**

1. Run: `vercel deploy` (no `--prod`)
2. Wait for the build to complete. Capture the preview URL from stdout.
3. If build fails, print the build log and HALT. Common causes: missing env var (re-check phase 5), TypeScript error (rerun phase 3 step 11).

**Acceptance:**
- Preview URL is accessible (curl returns 200 for `/`)
- Build log shows no errors

---

## Phase 7 — Verification

**Goal:** Confirm the new instance is functionally healthy end-to-end on the preview.

**Steps:**

1. Health check the GHL integration:
   ```bash
   curl -s "<preview-url>/api/health/ghl" | tee /tmp/health.json
   ```
   - Expected: HTTP 200, JSON body with every pipeline/stage/CF/CV/workflow resolved.
   - If any item shows `missing: true`, capture for HANDOFF and continue (do not halt — most likely operator's phase 4b UI work is incomplete and needs re-running).
2. Smoke-test the lead form:
   ```bash
   curl -X POST "<preview-url>/api/lead" \
     -H "Content-Type: application/json" \
     -d '{"firstName":"Preflight","lastName":"Test","email":"preflight+<timestamp>@example.com","phone":"+15555550100","source":"home","page":"/","ts":'$(($(date +%s)*1000 - 5000))',"website":""}'
   ```
   - Expected: `{"ok":true,...}`
   - Verify the contact appears in the new GHL sub-account (search by `preflight+<timestamp>@example.com`)
3. Run `npm test` against the deployed preview URL if env-driven base URLs are wired; else run locally with `BASE_URL=<preview-url>`.
4. Run `npm run check`.

**Acceptance:**
- `/api/health/ghl` returns 200 (any `missing` items captured for HANDOFF, not blocking)
- Synthetic lead appears in GHL
- `npm test` passes
- `npm run check` passes

---

## Phase 8 — Handoff generation

**Goal:** Write `HANDOFF.md` to the new client repo root, commit, and push.

**Steps:**

1. Write `HANDOFF.md` to the new repo root using the template below. Fill every `<placeholder>` with real values from phases 1-7. Derive the GHL UI checklist freshly from `config/ghl-schema.ts` — do NOT copy from `drafts/ghl-ui-checklist.md` (which may be stale if phase 4b discovered new items).
2. Commit: `git commit -am "docs: HANDOFF.md generated by AI replication"`
3. Push the repo to its remote (operator should have created it in advance; if not, surface a HALT-and-ask).
4. Print to the operator:
   - The HANDOFF.md path
   - The preview URL
   - A one-sentence summary: "Replication complete. N drafts approved, M GHL items remaining for you (see HANDOFF.md §Operator must complete), preview at <url>."

**Acceptance:**
- `HANDOFF.md` exists at repo root
- Latest commit references it
- Operator has been told where to look

---

## HANDOFF.md template (generated in phase 8)

Use this exact structure. Fill every `<placeholder>`. Re-derive the GHL UI checklist from `config/ghl-schema.ts` so it never drifts.

```markdown
# HANDOFF — <Studio Name>
**Generated:** <ISO 8601 timestamp>
**Preview:** <vercel preview URL>
**Repo:** <new repo URL>

## ✅ Completed
- Repo forked from template at commit `<sha>`
- Brand applied: logo, colors (primary `<hex>`, secondary `<hex>`, accent `<hex>`), favicon
- Content adapted: NAP, <N> instructors, <M> location pages, <K> FAQ overrides
- GHL provisioned: <N> custom values, <M> base tags
- Env vars set in Vercel (keys only, no values): <list>
- Deploy: preview at `<url>`, build green, `/api/health/ghl` returning 200
- Tests: <X>/<Y> passing

## ⏳ Operator must complete BEFORE production

### GHL UI work (cannot be API-automated)
- [ ] Pipelines (derive from `config/ghl-schema.ts` PIPELINES export — list each)
- [ ] Contact custom fields (derive from CONTACT_CUSTOM_FIELDS)
- [ ] Opportunity custom fields (derive from OPPORTUNITY_CUSTOM_FIELDS)
- [ ] Workflows + paste each webhook URL into its action (derive from WORKFLOWS — print preview-URL-prefixed webhook URLs)
- [ ] Re-run `<preview-url>/api/health/ghl` after UI work — must return all-green

### Content the client still owes
- [ ] Real studio photos for: <list of pages still on intake-provided URLs>
- [ ] Real parent testimonials for kids page (currently AI-drafted with disclaimer comment)
- [ ] Final instructor bios approved (drafts at `drafts/instructors/`)
- [ ] Belt-ceremony / class-in-action video (optional, high trust impact)

### Domain + DNS
- [ ] Point `<domain>` to Vercel (Vercel dashboard → Project → Domains → Add)
- [ ] Verify SSL certificate provisioned
- [ ] Confirm apex/www canonicalization in Vercel dashboard
  - **DO NOT** add a conflicting redirect in `vercel.json` (causes loop)

## ⚠️ Warnings raised during replication
<bullet list of any soft-fails from phases 0-7; empty section if none>

## 🚀 Going to production
1. Confirm every box above is checked
2. `vercel promote <preview-url> --prod`
3. Verify `https://<domain>/api/health/ghl` returns 200
4. Send a first real lead through the form, confirm it appears in GHL
5. Update `CLIENT_INTAKE.md` §9 with the final calendar IDs (operator's reference for future maintenance)

## 📚 Reference
- Architecture: `docs/superpowers/specs/2026-05-27-ai-replication-spec-design.md`
- GHL schema (source of truth): `config/ghl-schema.ts`
- Deep dives: `docs/ghl-api-integration-spec.md`, `docs/ghl-onboarding-runbook.md`
- Launch checklist: `docs/launch-checklist.md`
- AI-drafted content (review before publishing): `drafts/`

## 📞 Troubleshooting
- **Webhook 401s** → `GHL_WEBHOOK_SECRET` mismatch. Rotate the value in GHL workflow action header AND in Vercel env, redeploy.
- **`/api/health/ghl` reports missing pipelines** → Operator UI work in phase 4b incomplete. Re-check the schema names match exactly (case-sensitive, including spaces).
- **Booking form returns RATE_LIMITED on first try** → In-memory rate limit cold-start state. Wait 30 seconds and retry. (Architectural fix tracked in design spec §10 — kv adapter migration.)
- **Build fails on `sharp` import** → `npm install` may not have picked it up; try `npm install sharp --save-dev` and rebuild.
```

---

## Troubleshooting (REPLICATE.md appendix)

### Phase 0 halts on PIT 401
Rotate the PIT in GHL Settings → Private Integrations. Update `GHL_PIT_TOKEN` and retry phase 0.

### Phase 2 produces near-identical location drafts
The intake §6 cities are too thin — operator needs to add more specific landmarks + demographic notes. Halt and request richer inputs.

### Phase 3 TypeScript check fails
The intake data shape doesn't match `src/content/*` types. Fix the data, do NOT loosen the types.

### Phase 4 onboard:ghl discover reports MISSING items
Operator's phase 4b UI work is incomplete. Print the missing items, instruct operator to add them in GHL UI, then re-run `discover`.

### Phase 6 build fails
Common causes: missing env var (re-check phase 5), missing `sharp` (`npm install sharp --save-dev`), TypeScript error from phase 3 not fully fixed.

### Phase 7 health check reports missing CFs/CVs after operator says UI done
Names are case-sensitive and must match `config/ghl-schema.ts` exactly. Compare the missing item name against the schema.
```

- [ ] **Step 2: Verify REPLICATE.md parses + read it back end-to-end**

Run: `wc -l docs/replication/REPLICATE.md`
Expected: ~250-350 lines.

- [ ] **Step 3: Commit**

```bash
git add docs/replication/REPLICATE.md
git commit -m "feat(replication): REPLICATE.md phases 6-8 + HANDOFF template + troubleshooting"
```

---

## Task 8: Wire `prebuild` for OG images + add sharp dep

**Files:**
- Modify: `package.json`

This is also a fix for a launch blocker the build audit flagged: `scripts/og-image-*.mjs` imports `sharp` but it's missing from devDependencies.

- [ ] **Step 1: Verify the failure mode**

Run: `npm run build` — confirm whether it fails on `sharp` import or already passes. If it passes, the existing OG images in `public/og/` are stale and need regeneration; the fix is still needed.

- [ ] **Step 2: Install sharp + add prebuild script**

```bash
npm install --save-dev sharp
```

Then edit `package.json`. In the `scripts` block, add `prebuild`:

```json
{
  "scripts": {
    "dev": "astro dev",
    "build": "astro build",
    "preview": "astro preview",
    "astro": "astro",
    "check": "astro check",
    "test": "vitest run",
    "test:watch": "vitest",
    "onboard:ghl": "tsx scripts/onboard-client.ts",
    "validate:intake": "tsx scripts/intake-validator.ts",
    "prebuild": "node scripts/og-image-home.mjs && node scripts/og-image-adults.mjs && node scripts/og-image-kids.mjs"
  }
}
```

(The `validate:intake` script is wired now even though the script itself is written in Task 9 — adding it here in the same commit keeps `package.json` changes atomic.)

- [ ] **Step 3: Verify build runs prebuild + generates OG images**

```bash
rm -f public/og/home.jpg public/og/adults-jiu-jitsu.jpg public/og/kids-martial-arts.jpg
npm run build
ls public/og/
```

Expected: all three OG image files regenerated, build succeeds.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "feat(build): wire prebuild for OG images + add sharp dep + register validate:intake script"
```

---

## Task 9: Intake validator script — failing test

**Files:**
- Create: `scripts/intake-validator.test.ts`

- [ ] **Step 1: Write the failing test**

Create `scripts/intake-validator.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { validateIntake } from './intake-validator';

describe('validateIntake', () => {
  it('reports missing required field with field path', () => {
    const intake = `# Client Intake — Test

## 1. Identity
- **REQUIRED:** Legal business name — Test LLC
- **REQUIRED:** Brand name (display) — Test Studio
- **REQUIRED:** URL slug (lowercase, hyphens) — test-studio
`;
    const result = validateIntake(intake);
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('§1: missing REQUIRED field "Production domain"');
  });

  it('passes when every REQUIRED field has a non-empty value', () => {
    const intake = MINIMAL_VALID_INTAKE;
    const result = validateIntake(intake);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('reports value left as example placeholder', () => {
    const intake = MINIMAL_VALID_INTAKE.replace(
      'Legal business name — Test LLC',
      'Legal business name — e.g., `Gracie Barra Whittier LLC`',
    );
    const result = validateIntake(intake);
    expect(result.ok).toBe(false);
    expect(result.errors.some(e => e.includes('Legal business name') && e.includes('placeholder'))).toBe(true);
  });
});

// Smallest intake that satisfies every required field. Update when intake template changes.
const MINIMAL_VALID_INTAKE = `# Client Intake — Test

## 1. Identity
- **REQUIRED:** Legal business name — Test LLC
- **REQUIRED:** Brand name (display) — Test Studio
- **REQUIRED:** URL slug (lowercase, hyphens) — test-studio
- **REQUIRED:** Production domain — teststudio.com

## 2. NAP
- **REQUIRED:** Street address + suite — 1 Test St
- **REQUIRED:** City — Testville
- **REQUIRED:** State (2-letter) — CA
- **REQUIRED:** Zip — 90000
- **REQUIRED:** Country (2-letter) — US
- **REQUIRED:** Phone display — (555) 555-0100
- **REQUIRED:** Phone tel: format — +15555550100
- **REQUIRED:** Public email — info@teststudio.com
- **REQUIRED:** Latitude — 34.0
- **REQUIRED:** Longitude — -118.0
- **REQUIRED:** Google Maps URL — https://maps.google.com/?cid=123
- **REQUIRED:** Google Business Profile place ID — ChIJTest
- **REQUIRED:** Hours per day — Mon-Fri 09:00-21:00

## 3. Brand
- **REQUIRED:** Logo SVG — horizontal/wide variant — https://cdn.test/logo-h.svg
- **REQUIRED:** Logo SVG — vertical/stacked variant — https://cdn.test/logo-v.svg
- **REQUIRED:** Logo SVG — icon-only variant — https://cdn.test/logo-i.svg
- **REQUIRED:** Favicon (SVG or PNG ≥192px) — https://cdn.test/favicon.svg
- **REQUIRED:** Primary color hex — #1b2a5e
- **REQUIRED:** Secondary color hex — #cc2200
- **REQUIRED:** Accent color hex — #ef9f27
- **REQUIRED:** Brand voice — welcoming, disciplined, family-first

## 9. GHL workspace
- **REQUIRED:** Sub-account ID (Location ID) — abc123
- **REQUIRED:** Private Integration Token (PIT) — pit-test-token
- **REQUIRED:** Whether pipelines already exist in this sub-account — no

## 10. Deploy
- **REQUIRED:** Vercel team/org name — test-org
- **REQUIRED:** Vercel project name preference — test-project
- **REQUIRED:** Production domain — teststudio.com
- **REQUIRED:** DNS access — operator-handles
- **REQUIRED:** Notification email for deploy events — ops@teststudio.com
`;
```

- [ ] **Step 2: Run the test to verify it fails (file does not exist yet)**

```bash
npm test scripts/intake-validator.test.ts
```

Expected: FAIL with "Cannot find module './intake-validator'" or equivalent.

- [ ] **Step 3: Commit**

```bash
git add scripts/intake-validator.test.ts
git commit -m "test(intake-validator): failing tests for required-field + placeholder detection"
```

---

## Task 10: Intake validator script — implement

**Files:**
- Create: `scripts/intake-validator.ts`

- [ ] **Step 1: Write the minimal implementation that passes the tests**

Create `scripts/intake-validator.ts`:

```typescript
#!/usr/bin/env node
/**
 * intake-validator — phase 0 preflight for AI replication.
 *
 * Usage:
 *   npm run validate:intake CLIENT_INTAKE.md
 *
 * Parses an intake markdown file, verifies every REQUIRED field has a
 * non-empty value that is not a placeholder ("e.g., ..." patterns).
 * Returns ok=true with no errors when valid; otherwise lists every issue.
 *
 * Asset URL reachability (HTTP 200) is checked in phase 0 by the AI itself
 * via curl — this script only does shape/required validation.
 */

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  requiredFieldsFound: number;
}

interface RequiredField {
  section: string;       // e.g., "§1"
  label: string;         // e.g., "Legal business name"
}

/** Pattern that marks an unfilled placeholder example. */
const PLACEHOLDER_PATTERN = /\b(e\.g\.|placeholder|TBD|TODO|<.+?>)\b/i;

const REQUIRED_LINE_RE = /^- \*\*REQUIRED:\*\* (.+?) — (.+)$/;
const SECTION_RE = /^## (\d+)\. /;

export function validateIntake(markdown: string): ValidationResult {
  const lines = markdown.split(/\r?\n/);
  const errors: string[] = [];
  let currentSection = '?';
  let requiredFieldsFound = 0;

  for (const line of lines) {
    const sectionMatch = line.match(SECTION_RE);
    if (sectionMatch) {
      currentSection = `§${sectionMatch[1]}`;
      continue;
    }
    const fieldMatch = line.match(REQUIRED_LINE_RE);
    if (!fieldMatch) continue;
    const label = fieldMatch[1].trim();
    const value = fieldMatch[2].trim();
    requiredFieldsFound += 1;
    if (!value) {
      errors.push(`${currentSection}: missing REQUIRED field "${label}"`);
      continue;
    }
    if (PLACEHOLDER_PATTERN.test(value)) {
      errors.push(`${currentSection}: REQUIRED field "${label}" still has placeholder value: ${value}`);
    }
  }

  // Cross-section: every REQUIRED label declared in the template must appear in the intake.
  const declaredLabels = extractDeclaredRequiredLabels();
  const seenLabels = new Set<string>();
  for (const line of lines) {
    const m = line.match(REQUIRED_LINE_RE);
    if (m) seenLabels.add(m[1].trim());
  }
  for (const { section, label } of declaredLabels) {
    if (!seenLabels.has(label)) {
      errors.push(`${section}: missing REQUIRED field "${label}"`);
    }
  }

  return { ok: errors.length === 0, errors, requiredFieldsFound };
}

/**
 * Reads the canonical template (CLIENT_INTAKE.template.md) and extracts
 * every REQUIRED label so we can detect omissions. The template is the
 * source of truth for what fields exist.
 */
function extractDeclaredRequiredLabels(): RequiredField[] {
  // Resolved at runtime when invoked as a CLI; in tests, the harness
  // does not need this list (tests assert on present-but-invalid values).
  // We import lazily to avoid file IO when validateIntake is called from tests
  // with a self-contained string.
  try {
    // Use require so this works under tsx + vitest without ESM acrobatics.
    const fs = require('node:fs');
    const path = require('node:path');
    const tplPath = path.join(__dirname, '..', 'docs', 'replication', 'CLIENT_INTAKE.template.md');
    if (!fs.existsSync(tplPath)) return [];
    const tpl = fs.readFileSync(tplPath, 'utf8');
    const out: RequiredField[] = [];
    let section = '?';
    for (const line of tpl.split(/\r?\n/)) {
      const s = line.match(SECTION_RE);
      if (s) { section = `§${s[1]}`; continue; }
      const m = line.match(REQUIRED_LINE_RE);
      if (m) out.push({ section, label: m[1].trim() });
    }
    return out;
  } catch {
    return [];
  }
}

// ─── CLI entry ───────────────────────────────────────────────────────────────

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('Usage: npm run validate:intake <path-to-intake.md>');
    process.exit(2);
  }
  const fs = await import('node:fs');
  if (!fs.existsSync(filePath)) {
    console.error(`Intake file not found: ${filePath}`);
    process.exit(2);
  }
  const text = fs.readFileSync(filePath, 'utf8');
  const result = validateIntake(text);
  if (result.ok) {
    console.log(`INTAKE VALID — ${result.requiredFieldsFound} required fields present.`);
    process.exit(0);
  }
  console.error(`INTAKE INVALID — ${result.errors.length} issue(s):`);
  for (const e of result.errors) console.error(`  • ${e}`);
  process.exit(1);
}

// Run main only when invoked directly (not when imported by tests).
if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}`) {
  main();
}
```

- [ ] **Step 2: Run the tests to verify they pass**

```bash
npm test scripts/intake-validator.test.ts
```

Expected: 3 tests pass.

- [ ] **Step 3: Run the CLI against the template itself (sanity check — template is intentionally not filled, so should report many missing-or-placeholder)**

```bash
npm run validate:intake docs/replication/CLIENT_INTAKE.template.md
```

Expected: exit 1, listing every REQUIRED field as a placeholder (because the template's example values include `e.g.,` markers).

- [ ] **Step 4: Commit**

```bash
git add scripts/intake-validator.ts
git commit -m "feat(intake-validator): implement REQUIRED-field + placeholder detection"
```

---

## Task 11: Cross-reference audit + path verification

**Files:**
- Modify: `docs/replication/REPLICATE.md` (if any references are broken)

- [ ] **Step 1: Enumerate every file/path/script referenced by REPLICATE.md and CLIENT_INTAKE.template.md**

Run this grep to extract referenced paths:

```bash
grep -oE '(src|scripts|docs|public|config)/[A-Za-z0-9_\-/.]+' \
  docs/replication/REPLICATE.md docs/replication/CLIENT_INTAKE.template.md \
  | sort -u > /tmp/refs.txt
cat /tmp/refs.txt
```

- [ ] **Step 2: Verify each referenced path exists**

```bash
while read -r path; do
  [[ -e "$path" ]] || echo "MISSING: $path"
done < /tmp/refs.txt
```

Expected output: empty (no MISSING lines).

If any path is missing, either:
- (a) Fix the reference in the doc to the correct path, OR
- (b) Note that the path is created by AI at runtime (e.g., `drafts/`, `.env.production`, `.env.client.local`, `HANDOFF.md`, `CLIENT_INTAKE.md`) — these are expected to not exist in the template repo.

- [ ] **Step 3: Verify npm scripts referenced exist in package.json**

```bash
grep -oE 'npm run [a-z:]+' docs/replication/REPLICATE.md | sort -u | while read -r cmd; do
  name="${cmd#npm run }"
  grep -q "\"$name\":" package.json || echo "MISSING SCRIPT: $name"
done
```

Expected: empty.

- [ ] **Step 4: If fixes needed, commit them**

```bash
# Only if changes made:
git add docs/replication/REPLICATE.md
git commit -m "fix(replication): correct broken path references in REPLICATE.md"
```

If no changes needed, skip this step.

---

## Task 12: Update top-level README + smoke test the closing loop

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Replace the default Astro starter README with project orientation**

Overwrite `README.md`:

```markdown
# Gracie Barra Whittier — template repo

Astro 6 + Vercel + GoHighLevel marketing/CRM template for martial arts studios.

## What this is

A lead-capture and class-booking site for a Gracie Barra location, with deep CRM
integration: opt-in flows, trial booking, rebook flows, Back-to-the-Mats reactivation,
SMS bot, and GHL workflow orchestration.

## Architecture

Layered: Astro pages → API routes (Zod-validated) → single domain orchestrator
(`src/lib/ghl-adapter.ts`) → GHL HTTP client. GHL itself is the system of record.
See `docs/superpowers/specs/2026-05-27-ai-replication-spec-design.md` §architecture
for the full layering.

## Running locally

```bash
npm install
cp .env.example .env       # fill in PIT, location ID, signing keys
npm run dev                # http://localhost:4321
```

Tests:

```bash
npm test                   # vitest unit
npx playwright test        # e2e (requires running dev server)
```

## Replicating this for a new client

This repo is built as a template. To stand up a new client:

1. Operator: fill `docs/replication/CLIENT_INTAKE.template.md` → save as `CLIENT_INTAKE.md`
2. Operator: `npm run validate:intake CLIENT_INTAKE.md`
3. Hand the filled intake + this repo to a Claude (or equivalent) session with:
   "Execute `docs/replication/REPLICATE.md`"
4. AI runs 9 phases (intake validation → brand swap → content drafting → content
   swap → GHL provisioning → env wiring → preview deploy → verification → handoff)
5. AI generates `HANDOFF.md` in the new repo listing remaining operator work
   (GHL UI clicks, real photos, real testimonials, DNS swap, production promote)

See [docs/replication/README.md](docs/replication/README.md) for the orientation.

## Key references

| Topic | File |
|---|---|
| Architecture & design | `docs/superpowers/specs/2026-05-27-ai-replication-spec-design.md` |
| GHL schema (source of truth) | `config/ghl-schema.ts` |
| GHL API contract | `docs/ghl-api-integration-spec.md` |
| GHL onboarding runbook | `docs/ghl-onboarding-runbook.md` |
| GHL dashboard build guide | `docs/ghl-dashboard-build-guide.md` |
| Launch checklist | `docs/launch-checklist.md` |
| Replication procedure | `docs/replication/REPLICATE.md` |
```

- [ ] **Step 2: Smoke test the full intake → validator loop**

Create a minimal valid intake in a temp file (do NOT commit):

```bash
cp docs/replication/CLIENT_INTAKE.template.md /tmp/test-intake.md
```

Manually edit `/tmp/test-intake.md` to replace every `e.g., ...` example with a concrete value (mirror the `MINIMAL_VALID_INTAKE` constant from `scripts/intake-validator.test.ts`).

Run:
```bash
npm run validate:intake /tmp/test-intake.md
```

Expected: `INTAKE VALID — <N> required fields present.` (exit 0).

If validator reports issues that contradict the test fixture, fix the validator OR the template (whichever is wrong). Re-run tests after.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: rewrite README with project orientation + replication entry point"
```

---

## Self-review checklist (run before declaring plan complete)

- **Spec coverage:**
  - Spec §3 Definition of done items 1-5 → covered by phases 1-8 acceptance criteria ✓
  - Spec §4 artifact shape (REPLICATE + INTAKE + generated HANDOFF) → Tasks 2-7 ✓
  - Spec §5 nine phases → Tasks 5-7 (the REPLICATE.md content) ✓
  - Spec §6 thirteen intake sections → Tasks 2-4 ✓
  - Spec §7 HANDOFF structure → Task 7 ✓
  - Spec §8 slots into existing docs → Task 1 (README orientation), Task 12 (top-level README) ✓
  - Spec §9 risks → mitigations baked into REPLICATE.md hard rules + validator script ✓
  - Spec §10 open questions deferred → no plan tasks (correctly deferred) ✓
  - Spec §11 success metric → Task 12 smoke test exercises the loop ✓

- **Placeholder scan:** No "TBD" / "TODO" / "fill in later" / "similar to Task N" in any step. Every code block contains real code. ✓

- **Type consistency:** `validateIntake` signature consistent across Task 9 (test) and Task 10 (impl). `ValidationResult.errors` is `string[]` in both. ✓

- **Reference consistency:** `npm run validate:intake` introduced in Task 8 `package.json` and used in Tasks 9-12. `npm run prebuild` introduced in Task 8 and not referenced elsewhere (used implicitly by `npm run build`). ✓