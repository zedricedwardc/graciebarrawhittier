# Admin Dashboard Widgets — Upcoming Appointments + Lead Breakdown

**Date:** 2026-06-19 · **Status:** Approved (brainstorming) · **Branch target:** `master`

Two custom widgets in the existing token-gated Astro admin (the Shopify/Polaris-
style page iframed into GHL), fed live from the GHL API via `src/lib/ghl.ts`.

## Goal

Give the studio admin a single page with:

1. **Upcoming Appointments** — next 7 days across the 5 trial calendars + 5
   optional Back-to-the-Mats calendars. Per row: contact **name**, **time**,
   **program**, **flow** (Trial / BTM), and the contact's lead **source**.
2. **Lead Tracking Breakdown** — count of new contacts per channel
   (`Website Leads / Walk-In / Meta Ads / Google Ads / Referral / Website Chat`)
   over a switchable range (Last 7 / 30 / 90 days / MTD).

## Non-goals (YAGNI)

- No revenue/enrollment/funnel widgets (those live in the GHL-native dashboard —
  see `docs/replication/ghl-dashboard-build-spec.md`).
- No page-level (sub-source) drill-down — channel-level only.
- No new auth scope: the existing admin token (verified by `requireAdmin`) gates
  the new routes and page unchanged.

## Architecture (approach B — SSR shell + JSON API routes)

Mirrors the blog admin exactly:

```
/admin/dashboard.astro   ── SSR token gate + CSP frame-ancestors (copied from blog)
       │  SSR initial render: appointments + leads(default 30d)
       │  client JS: range toggle + refresh → fetch the two routes
       ▼
/api/admin/dashboard/appointments.ts   GET → { ok, appointments[], warnings[] }
/api/admin/dashboard/leads.ts          GET ?range=7d|30d|90d|mtd → { ok, breakdown }
       │  requireAdmin() + json() from lib/admin-api.ts
       ▼
src/lib/dashboard-data.ts   ── aggregators (the unit under test)
       ▼
src/lib/ghl.ts   ── getCalendarEvents, getContact (exist) + searchContactsByDateRange (new)
```

## Components & interfaces

### 1. `src/lib/dashboard-data.ts` (new — the testable core)

```ts
export type AppointmentFlow = 'trial' | 'btm';

export interface UpcomingAppointment {
  id: string;
  contactId: string | null;
  contactName: string;          // "" → rendered as "Unknown contact"
  startTimeISO: string;
  endTimeISO: string | null;
  program: string;              // e.g. "Adults BJJ" (from calendar→program map)
  flow: AppointmentFlow;
  source: string;               // a LeadChannel value, or "Unknown"
  status: string;               // appointmentStatus (confirmed/…)
}

// Next 7 days, trial + (present) BTM calendars, sorted by startTime asc.
export function getUpcomingAppointments(opts?: { now?: Date }): Promise<{
  appointments: UpcomingAppointment[];
  warnings: string[];           // e.g. "Adults BTM calendar fetch failed"
}>;

export type LeadRange = '7d' | '30d' | '90d' | 'mtd';

export interface LeadBreakdown {
  range: LeadRange;
  sinceISO: string;
  total: number;
  channels: Array<{ channel: string; count: number; pct: number }>; // all 6 + "Other", desc by count
}

export function getLeadBreakdown(range: LeadRange, opts?: { now?: Date }): Promise<LeadBreakdown>;
```

Behavior:

- **Calendars** are resolved from env via the existing program config
  (`GHL_CAL_*` trial, `GHL_CAL_BTM_*` BTM). BTM vars are optional — **skipped
  silently when unset** (they're marked optional in `config/ghl-schema.ts`). The
  calendar→program label + flow map is derived from `src/data/programs.ts`, not
  hardcoded GBW strings (templatable per CLAUDE.md).
- **Source per appointment** is an N+1 join: `getCalendarEvents` returns
  `contactId` only, so each distinct contact is fetched via `getContact` and its
  native `source` attribute read, bucketed to a `LeadChannel` (fallback
  `lead_source` CF, else `"Unknown"`). A **request-scoped `Map<contactId,…>`
  cache** dedupes repeat contacts within one build.
- **Per-calendar failures degrade gracefully** — one calendar erroring adds a
  `warnings[]` entry; the rest still render.
- **Lead counts** call `searchContactsByDateRange` and bucket each contact by
  native `source` into the 6 `LEAD_CHANNELS` (+ `"Other"`). Range → `since`:
  `7d/30d/90d` = now − N days; `mtd` = first of current month. Percentages are
  of `total` (0 when total is 0; no divide-by-zero).

### 2. `src/lib/ghl.ts` (extend)

Add one function (reuse existing `request`, `locationId`, `ContactRecord`):

```ts
// Paginated /contacts/search by dateAdded range; returns contacts + reported total.
export function searchContactsByDateRange(args: {
  startMs: number; endMs: number; page?: number; pageLimit?: number;
}): Promise<{ contacts: ContactRecord[]; total: number }>;
```

Confirm during TDD whether `/contacts/search` filters by `dateAdded` server-side;
if the `source`/`dateAdded` filter is unreliable (per memory: native `source` is
not a group-by dimension), paginate by date range and bucket client-side. Either
way bucketing happens in `dashboard-data.ts`, so the data shape above is stable.
Ensure `ContactRecord` exposes `source` and `customFields` (add if missing).

### 3. API routes (token-gated, thin)

- `GET /api/admin/dashboard/appointments` → `{ ok, appointments, warnings }`.
- `GET /api/admin/dashboard/leads?range=30d` → `{ ok, breakdown }`; bad range → 400.
- Both: `requireAdmin(request, url)` → 401 `INVALID_TOKEN` on failure; `json()`
  helper; `export const prerender = false`; GHL errors logged + `502 GHL_FAILED`.
- **~60s in-module response cache** keyed by route(+range) so the page's refresh
  / auto-refresh doesn't hammer the N+1 contact lookups. (Plain module-level
  `Map` with timestamp; serverless-warm best-effort, correctness-neutral.)

### 4. `/admin/dashboard.astro` (new page)

- Copy the blog page's **SSR token gate** (`t` param → `verifyAdminToken`, 401
  page on failure) and the **CSP `frame-ancestors`** header block verbatim
  (incl. `ADMIN_FRAME_ANCESTORS`) so it loads inside the GHL iframe.
- Self-contained Polaris-ish styles + `styles/tokens.css`; **no BaseLayout**.
- SSR the initial view (call `getUpcomingAppointments()` +
  `getLeadBreakdown('30d')` directly server-side, like blog calls
  `listPublishedPosts`; degrade to empty + error banner on throw).
- **Card A — Upcoming Appointments:** table `Name | Time | Program | Flow | Source`.
  Source rendered as a colored channel badge; Flow as a Trial/BTM tag. Empty
  state: "No appointments in the next 7 days." A manual **Refresh** button +
  optional 60s auto-refresh re-fetches `/appointments`.
- **Card B — Lead Tracking Breakdown:** range toggle (7d/30d/90d/MTD) +
  horizontal bar list (channel label, count, % bar). Changing range fetches
  `/leads?range=…` and re-renders client-side. Empty state when total is 0.
- Embedded `data-admin-token` re-sent as `x-admin-token` on every client fetch
  (same pattern as blog).

## Error handling

| Failure | Behavior |
|---|---|
| Bad/expired/missing token | 401 page (SSR) / 401 JSON (routes) |
| One calendar fetch throws | Skipped; `warnings[]` entry; others render |
| Contact fetch throws / no source | Source = `"Unknown"` |
| Whole GHL call fails (SSR) | Card renders empty + inline error banner |
| Whole GHL call fails (route) | `502 GHL_FAILED` |
| BTM env vars unset | Those calendars silently omitted |

## Testing (TDD, Vitest — mock `ghl.ts`)

`dashboard-data.test.ts`:
- range→since resolution for 7d/30d/90d/mtd (inject `now`).
- channel bucketing incl. unknown/empty source → `"Other"`; pct math; total 0.
- appointment merge across calendars, sort by startTime, BTM-optional skipping.
- contact-cache dedupe (one `getContact` per distinct contactId).
- per-calendar failure → warning, partial result.

Route tests mirror `blog/auth.test.ts`: 401 without token; happy-path shape;
bad `range` → 400.

## Templatability check (CLAUDE.md)

No GBW-specific hardcodes: calendars from `GHL_CAL_*` env, channels from
`LEAD_CHANNELS`, program labels/flow from `src/data/programs.ts`. Frame-ancestors
honor `ADMIN_FRAME_ANCESTORS`. Reusable for any gym build.

## Rollout note (runbook)

Surface as a GHL custom menu link (iframe to `/admin/dashboard?t=<token>`), same
as the blog admin. Reuse the existing minted admin token. Add a short section to
`docs/replication/` after build.
