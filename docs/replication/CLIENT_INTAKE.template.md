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
