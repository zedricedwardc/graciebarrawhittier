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
   npm install         # picks up sharp from devDependencies
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
