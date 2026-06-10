# GHL Setup — Master Checklist

A combined, dependency-ordered checklist that pairs with [`intro-campaign-setup.md`](./intro-campaign-setup.md) and [`btm-campaign-setup.md`](./btm-campaign-setup.md). Use this as your live tick-list while you work; jump to the referenced doc section for click-paths and acceptance details.

**Phase legend**: `[DEV]` = developer (terminal, `npm`, Vercel CLI). `[ADMIN]` = studio admin (GHL UI only). `[BOTH]` = hand-off between roles.

---

## Pre-flight

- [ ] **[ADMIN]** Confirm SMS-consent records for any phone numbers you plan to bulk-import for BTM (legal gate, BTM only) — [btm › §3.3 + §15](./btm-campaign-setup.md) — **done when:** you have a written record per number, or have stripped non-consenting numbers from CSV.
- [ ] **[ADMIN]** Read the Concepts block + Glossary in both docs before clicking anything — [intro › Concepts + §15](./intro-campaign-setup.md) — **done when:** you can define opportunity, pipeline, stage, custom value, custom field, merge tag, `trainee_key`, backflow.

## Intro funnel — developer prep

- [ ] **[DEV]** Clone repo, `npm install`, copy `.env.example` to `.env` — [intro › §10 Phase A.1](./intro-campaign-setup.md) — **done when:** `.env` exists with `GHL_PIT_TOKEN` + `GHL_LOCATION_ID` + generated secrets (incl. `HEALTH_KEY` saved to password manager).
- [ ] **[ADMIN]** Create GHL Private Integration Token with all scopes listed in intro §3.2 — [intro › §3](./intro-campaign-setup.md) — **done when:** PIT pasted into `.env` and verified via any test API call.
- [ ] **[DEV]** Import repo to Vercel; set production domain — [intro › §10 Phase A.2](./intro-campaign-setup.md) — **done when:** build completes (endpoints will 502 until env vars set; that's expected).
- [ ] **[DEV]** Print the schema-derived checklist: `npm run onboard:ghl checklist > onboarding-checklist.txt` — [intro › §10 Phase B.3](./intro-campaign-setup.md) — **done when:** file lists every pipeline, stage, custom field, workflow expected.

## Intro funnel — GHL UI

- [ ] **[ADMIN]** Log in to GHL; confirm location ID matches `GHL_LOCATION_ID` — [intro › §3.1](./intro-campaign-setup.md) — **done when:** URL shows the right `/location/<id>/`.
- [ ] **[ADMIN]** Create pipeline `Lead Acquisition` with 5 stages, exact names, correct Won/Lost flags — [intro › §6](./intro-campaign-setup.md) — **done when:** pipeline visible at Settings → Pipelines, 5 stages, `INTRO BOOKED (WON)` = Won, `LOST / COLD` = Lost.
- [ ] **[ADMIN]** Create pipeline `Trial Conversion` with 8 stages — [intro › §6](./intro-campaign-setup.md) — **done when:** 8 stages, `STUDENT ENROLLED (WON)` = Won, `LOST / COLD` = Lost.
- [ ] **[ADMIN]** Create pipeline `Trial Credit Monitoring` with 9 stages — [intro › §6](./intro-campaign-setup.md) — **done when:** 9 stages, `WON ENROLLED` = Won, `LOST` = Lost.

## Provisioning (shared)

- [ ] **[DEV]** Run `npm run onboard:ghl provision` (from repo root) — [intro › §10 Phase D.8](./intro-campaign-setup.md) + [btm › §11.4](./btm-campaign-setup.md) — **done when:** all custom values from intro §4 + BTM §4 exist; all contact + opportunity custom fields exist; idempotent re-run reports no errors.
- [ ] **[ADMIN]** Manually set the two webhook custom values: `Website Webhook Base URL` + `Website Webhook Secret` — [intro › §10 Phase D.9](./intro-campaign-setup.md) — **done when:** both appear in Settings → Custom Values with correct values (no trailing slash on URL; secret matches `GHL_WEBHOOK_SECRET` env var).

## Intro workflows

- [ ] **[ADMIN]** Create the 16 intro workflows per [intro › §7](./intro-campaign-setup.md) (12 campaign + 4 backflow) — each Published — **done when:** all 16 listed Published; each trigger and tail matches the §7 table; backflow webhooks have `X-GBW-Secret` header + JSON body matching §7.12 template.
- [ ] **[ADMIN]** For Pre-Trial Reminders REBOOK branch: add the morning-of `Wait Until → 00:01 PT on {{appointment.start_time}}` → `Update Opp Stage → APPOINTMENT TODAY` with **Duplicate Opportunity DISABLED** — [intro › §7.4.4](./intro-campaign-setup.md) — **done when:** the Wait + Update Stage steps are visible in the workflow editor on the FOUND branch.

## BTM-specific setup

- [ ] **[ADMIN]** Set `Back to the Mats Deadline` custom value (human-readable e.g. `Friday, June 8, 2026` OR ISO) — [btm › §11.5](./btm-campaign-setup.md) — **done when:** visiting `/back-to-the-mats` after deploy renders correct deadline + countdown.
- [ ] **[ADMIN]** Create BTM pipeline `Back to the Mats` with 6 stages — [btm › §11.1](./btm-campaign-setup.md) — **done when:** 6 stages, `RE ENROLLED` = Won, `OFFER EXPIRED` = Lost.
- [ ] **[ADMIN]** Create the 3 BTM workflows per [btm › §8](./btm-campaign-setup.md) — each Published — **done when:** `BTM 30-Day Campaign`, `BTM Appointment Confirmation`, `BTM Re-Booking Campaign (no-show)` all Published with correct triggers.
- [ ] **[ADMIN]** For `BTM Appointment Confirmation`: add the `Wait Until → Appointment Date @ 12:01 AM PT` → `Update Stage → APPOINTMENT TODAY` tail with **Duplicate Opportunity DISABLED** — [btm › §8.2 + §11.2](./btm-campaign-setup.md) — **done when:** tail visible in workflow editor with the correct CF anchor.
- [ ] **[ADMIN]** Create 5 BTM calendars in `Back to the Mats` calendar group, naming them per [btm › §7](./btm-campaign-setup.md) — **done when:** 5 `BTM <Program>` calendars exist in the new group, names contain the program-tier keywords from §11.6 so the discover script matches them.

## Discover + env paste

- [ ] **[DEV]** Run `npm run onboard:ghl discover` (from repo root) — [intro › §10 Phase E.10](./intro-campaign-setup.md) — **done when:** `.env.client.local` created in repo root with every `PIPELINE_ID_*`, `WORKFLOW_ID_*`, `GHL_CAL_*`; zero "Could not find …" warnings.
- [ ] **[DEV]** Run `npx tsx scripts/discover-btm-calendars.ts` — [btm › §11.6](./btm-campaign-setup.md) — **done when:** `.env.client.local` contains `GHL_CAL_BTM_TINY/LC1/LC2/JUNIORS/ADULTS` all non-empty.
- [ ] **[DEV]** Paste every `key=value` from `.env.client.local` into Vercel → Project → Settings → Environment Variables; check Production + Preview boxes; redeploy — [intro › §10 Phase F.11](./intro-campaign-setup.md) + [btm › §11.7](./btm-campaign-setup.md) — **done when:** Vercel shows ~25 env vars set; redeploy succeeds.

## Verification

- [ ] **[DEV/ADMIN]** Health check: `curl "https://<domain>/api/health/ghl?key=<HEALTH_KEY>"` — both docs — **done when:** returns `{ ok: true, drift: [] }`. If `drift` is non-empty, names in GHL don't match the schema — fix the names and re-run.
- [ ] **[ADMIN]** Smoke-test intro funnel end-to-end with your own email/phone (steps from intro §13.1–§13.11) — [intro › §13](./intro-campaign-setup.md) — **done when:** contact moves through `NEW LEAD` → `INTRO BOOKED (WON)`, `TRIAL_CONV` reaches `TRIAL ACTIVE NURTURE`, `CREDIT_MON` opp appears with `credits_remaining=3`, rebook works, manual `ATTENDED APPOINTMENT` decrement happens.
- [ ] **[ADMIN]** Verify intro morning-of auto-move via workflow-editor sanity check (or 24h wait) — [intro › §13.10](./intro-campaign-setup.md).
- [ ] **[ADMIN]** Smoke-test BTM with a single test contact (steps from btm §14) — [btm › §14](./btm-campaign-setup.md) — **done when:** contact moves `FORMER STUDENT` → `RE ENROLLMENT CLASS BOOKED`, Email 1 received from 30-Day Campaign, NO new opp in `Lead Acquisition` or `Trial Conversion`, no-show fires Re-Booking Campaign, re-book moves opp back to `RE ENROLLMENT CLASS BOOKED`.

## BTM bulk import (ONLY after smoke-test passes)

- [ ] **[ADMIN]** Re-confirm SMS opt-in compliance for the CSV — [btm › §15](./btm-campaign-setup.md) — **done when:** signed-off.
- [ ] **[ADMIN]** Stage 10A: Bulk CSV import with tag `back-to-the-mats-import` + `Back to the Mats Imported At = today` — [btm › §11.10A](./btm-campaign-setup.md) — **done when:** contacts appear, all tagged, custom field stamped.
- [ ] **[ADMIN]** Stage 10B: Bulk-add tagged contacts to pipeline `Back to the Mats → FORMER STUDENT` (or use a tag-triggered workflow) — [btm › §11.10B](./btm-campaign-setup.md) — **done when:** opp count in `FORMER STUDENT` matches CSV row count.
- [ ] **[ADMIN]** Stage 10C: Verify 30-Day Campaign delivery — [btm › §11.10C](./btm-campaign-setup.md) — **done when:** Workflow Statistics shows enrolled contacts matching import volume; Email 1 delivering.
- [ ] **[DEV]** Re-run health check after import — both docs — **done when:** `{ ok: true, drift: [] }`.

## Blog (optional — website blog via GHL Blogs)

See [`blog-setup.md`](./blog-setup.md) for full detail (PIT scopes + click-paths).

- [ ] **[ADMIN]** Add the blog PIT scopes (`blogs/*`, `medias.write`, `custom-menu-link.write`) — [blog › §1](./blog-setup.md) — **done when:** the token has all nine scopes ticked.
- [ ] **[ADMIN]** Create a blog site + author + category in GHL → Sites → Blogs — [blog › §2](./blog-setup.md) — **done when:** one of each exists.
- [ ] **[DEV]** Run `npm run onboard:blog discover` — [blog › §3](./blog-setup.md) — **done when:** `.env.client.local` has non-empty `GHL_BLOG_ID`, `GHL_BLOG_AUTHOR_ID`, `GHL_BLOG_DEFAULT_CATEGORY_ID`.
- [ ] **[DEV]** Set `ADMIN_SIGNING_KEY` (>= 32 chars) + paste the three `GHL_BLOG_*` IDs into Vercel; redeploy — [blog › §3](./blog-setup.md) — **done when:** `/blog` renders on the deployed site.
- [ ] **[DEV]** Connect a Vercel Blob store: `vercel blob create-store <gym>-blog --access public --yes` (links the project + injects `BLOB_READ_WRITE_TOKEN` in all envs) — [blog › §3b](./blog-setup.md) — **done when:** `vercel env ls` shows `BLOB_READ_WRITE_TOKEN`. **Required** — GHL's API never returns post bodies, so they persist in Blob; without it every post renders only its short description.
- [ ] **[DEV]** Set `BLOB_STORE_BASE_URL` (from `vercel blob get-store <store-id>`) in Vercel, all envs — [blog › §3b](./blog-setup.md) — **done when:** the var is set. (Recommended: makes the very first post's body render immediately on every instance.)
- [ ] **[DEV]** Dry-run then create the menu: `npm run onboard:blog menu` → `npm run onboard:blog menu -- --write` — [blog › §4](./blog-setup.md) — **done when:** "Website Blog" appears in the sub-account sidebar and opens the editor in an iframe. (Rotating `ADMIN_SIGNING_KEY` later invalidates the link — re-run this step.)
- [ ] **[DEV]** End-to-end verify: publish a test post **with a body longer than 160 characters**, confirm the FULL body renders on `/blog/<slug>`, then delete it — **done when:** the long body renders. ⚠️ A short test body cannot catch Blob failures — the auto-derived description is identical to a short body, so the page *looks* correct even when body persistence is broken.

---

## If something fails mid-setup

Run the health check first — it tells you exactly which names are misaligned:

```bash
curl "https://<your-domain>/api/health/ghl?key=<HEALTH_KEY>" | jq
```

A non-empty `drift` array contains entries like `pipeline:Lead Acqusition` (note the typo) — the name in GHL doesn't match the schema. Either fix the name in GHL or update the schema (file `config/ghl-schema.ts` is canonical).

For other failures see the Troubleshooting tables in each campaign doc:
- [intro › §14](./intro-campaign-setup.md)
- [btm › §16](./btm-campaign-setup.md)
