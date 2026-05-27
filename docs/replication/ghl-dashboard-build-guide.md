# GHL Dashboard — Click-by-Click Build Guide

A self-contained, do-it-yourself guide to building the studio dashboard in the
**Gracie Barra Whittier** GHL subaccount. Follow it top to bottom.

- **Companion doc:** `ghl-dashboard-build-spec.md` — explains *why* each widget
  is configured this way (pipeline reconciliation, double-count avoidance). Read
  it if a config below looks surprising; otherwise this guide is enough.
- **Time:** ~60–90 min for all 31 widgets.
- **You build it once.** GHL has no cross-subaccount dashboard clone.

---

## 0. Before you start — prerequisites

Tick these off first or widgets will show "No Data":

- [ ] **Opportunity revenue** — `enrolled_student_value` custom value exists
      (already created = `160`). BTM revenue workflow built — see
      `ghl-dashboard-build-spec.md` §5.
- [ ] **Lead source** — the website writes the native contact **Source**
      automatically (`Website Leads`). `Walk-In` needs the front-desk QR form
      (spec §4.4). `Meta Ads` / `Google Ads` stay empty until ads run.
- [ ] **GA4** connected — Settings → Integrations → Google Analytics (widgets 26–28).
- [ ] **Reputation** connected — Settings → Integrations → Google Business
      Profile (widgets 29–31).

A widget with no data yet is fine — it will populate once its source is live.

---

## 1. Open the dashboard editor

1. Log into GHL and switch into the **Gracie Barra Whittier** subaccount.
2. Left nav → **Dashboard**.
3. Top-right → **Add Dashboard** (or the **⋯** menu → *Add Dashboard*).
4. Name it: **`Studio Overview`**. Save.
5. Click **Edit Dashboard** (top-right) to enter edit mode — this is where you
   add/move/resize widgets.

### How every widget is added

For each widget below: **Add Widget** → pick the **widget type** → in the config
panel set **Data source**, **Filters**, **Date range**, then **Save**. After
saving, **drag** it into position and **drag its edge** to set the width.

**Width key:** `1/3` = one-third row · `1/2` = half row · `Full` = whole row.

**Global date range:** after all widgets are placed, set the dashboard date
filter (top-right) default to **Last 30 Days**.

---

## 2. Build the widgets — row by row

### Row 1 — Lead Flow KPIs

| # | Widget | Type | Config | Width |
|---|---|---|---|---|
| 1 | New Leads — Last 30 Days | Numeric / KPI | Source **Contacts**; filter **Created Date = Last 30 Days**; metric = Count | 1/3 |
| 2 | New Leads — Month to Date | Numeric / KPI | Source **Contacts**; **Created Date = Month to Date**; Count | 1/3 |
| 3 | Intro Classes Booked — 30 Days | Numeric / KPI | Source **Opportunities**; Pipeline **Trial Conversion**; Stage **INTRO BOOKED**; Created **Last 30 Days**; Count | 1/3 |

### Row 2 — Lead Trends

| # | Widget | Type | Config | Width |
|---|---|---|---|---|
| 4 | Lead Source Breakdown | Donut / Pie | Source **Contacts**; **Last 30 Days**; **Group by → Source** (native attribute). Shows Website Leads / Walk-In / Meta Ads / Google Ads / Referral | 1/2 |
| 5 | Leads Over Time | Line chart | Source **Contacts**; new contacts **by day**; **Last 30 Days** | 1/2 |

### Row 3 — Enrollment KPIs

| # | Widget | Type | Config | Width |
|---|---|---|---|---|
| 6 | New Enrollments — Last 30 Days | Numeric / KPI | Source **Opportunities**; Pipeline **Trial Conversion**; Stage **STUDENT ENROLLED (WON)**; **Last 30 Days**; Count. *(Do NOT also count Credit Monitoring WON ENROLLED — same enrollment, double-count.)* | 1/3 |
| 7 | New Enrollments — Month to Date | Numeric / KPI | Same as #6 but **Month to Date** | 1/3 |
| 8 | Revenue Generated — Last 30 Days | Numeric / KPI | Source **Opportunities**; **Status = Won**; Pipelines **Trial Conversion + Back to the Mats** only; **Last 30 Days**; metric = **Sum of Opportunity Value** | 1/3 |

### Row 4 — Revenue & Conversion

| # | Widget | Type | Config | Width |
|---|---|---|---|---|
| 9 | Total Revenue — All Time | Numeric / KPI | Same as #8 but **no date filter** (All Time) | 1/2 |
| 10 | Conversion Rate | Donut | Source **Opportunities**; Pipeline **Trial Conversion**; **Won vs Open** | 1/2 |

### Row 5 — Pipeline Health

| # | Widget | Type | Config | Width |
|---|---|---|---|---|
| 11 | Trial Conversion Funnel | Funnel | Source **Opportunities**; Pipeline **Trial Conversion** — shows drop-off stage by stage | 1/2 |
| 12 | Stage Distribution | Stage Distribution (bar/donut) | Pipeline **Trial Conversion**; current opp count per stage | 1/2 |

### Row 6 — Pipeline Metrics

| # | Widget | Type | Config | Width |
|---|---|---|---|---|
| 13 | Upcoming Classes — Next 7 Days | Numeric / KPI | Source **Appointments**; Status **Confirmed/Scheduled**; Date range **Next 7 Days**; the 5 trial calendars (+ 5 BTM calendars optional) | 1/3 |
| 14 | No-Shows — Last 30 Days | Numeric / KPI | Source **Appointments**; Status **No-Show**; **Last 30 Days** | 1/3 |
| 15 | Leads Stuck — Nurture Campaign | Numeric / KPI | Source **Opportunities**; Pipeline **Lead Acquisition**; Stage **NURTURE CAMPAIGN**; Count | 1/3 |

### Row 7 — Opportunity Overview

| # | Widget | Type | Config | Width |
|---|---|---|---|---|
| 16 | Opportunity Status Overview | Donut / Bar | Source **Opportunities**; **Open / Won / Lost**; **select only the 5 CIT pipelines** — Lead Acquisition, Trial Conversion, Trial Credit Monitoring, Back to the Mats, Revival Protocol. **Do NOT include legacy pipelines** (Academy Launch, Night King, Ultimate Trial, etc.) — they add 5,800+ junk opps | Full |

### Row 8 — Follow-Up

| # | Widget | Type | Config | Width |
|---|---|---|---|---|
| 17 | Pending Tasks | Tasks | Status **Pending**; **All Users** | 1/2 |
| 18 | Manual Actions Needed | Manual Actions | Phone / SMS / Total Pending (default) | 1/2 |

### Row 9 — Comms Metrics

| # | Widget | Type | Config | Width |
|---|---|---|---|---|
| 19 | Unread Conversations | Numeric / KPI | Source **Conversations**; Status **Unread** | 1/3 |
| 20 | Overdue Tasks | Numeric / KPI | Source **Tasks**; Status **Overdue** | 1/3 |
| 21 | SMS Sent — Last 30 Days | Numeric / KPI | Source **Conversations**; **Outbound SMS**; **Last 30 Days** | 1/3 |

### Row 10 — Lead Sources

| # | Widget | Type | Config | Width |
|---|---|---|---|---|
| 22 | Lead Source Report | Lead Source widget | Source **Contacts**; **Last 30 Days**; full breakdown by native **Source**. Values: `Website Leads`, `Walk-In`, `Meta Ads`, `Google Ads`, `Referral` | Full |

### Row 11 — Source Breakdown

| # | Widget | Type | Config | Width |
|---|---|---|---|---|
| 23 | Website Leads — Last 30 Days | Numeric / KPI | Source **Contacts**; **Source = Website Leads**; **Last 30 Days** | 1/3 |
| 24 | Walk-In Leads — Last 30 Days | Numeric / KPI | Source **Contacts**; **Source = Walk-In**; **Last 30 Days**. 0 until the front-desk QR form exists | 1/3 |
| 25 | Paid Ad Leads — Last 30 Days | Numeric / KPI | Source **Contacts**; **Source = Meta Ads OR Google Ads**; **Last 30 Days**. 0 until ads run | 1/3 |

### Row 12 — Website (Google Analytics)

| # | Widget | Type | Config | Width |
|---|---|---|---|---|
| 26 | Website Sessions — 30 Days | Google Analytics | GA4 → Sessions; **Last 30 Days** | 1/3 |
| 27 | Website Users — 30 Days | Google Analytics | GA4 → Users; **Last 30 Days** | 1/3 |
| 28 | Top Traffic Sources | Google Analytics | GA4 → Channel grouping (Organic / Direct / Paid / Social) | 1/3 |

> GA4 has a 24–48 h data delay — these are never real-time.

### Row 13 — Reputation

| # | Widget | Type | Config | Width |
|---|---|---|---|---|
| 29 | New Reviews — Last 30 Days | Reputation / Numeric | New Google reviews; **Last 30 Days** | 1/3 |
| 30 | Average Star Rating | Reputation / Numeric | Current average Google rating | 1/3 |
| 31 | Total Review Count | Reputation / Numeric | All-time Google review count | 1/3 |

---

## 3. Finish

1. Set the dashboard **date filter default → Last 30 Days** (top-right).
2. Click **Save** / exit edit mode.
3. **Sanity check** — confirm the subaccount has at least one contact, one
   opportunity, and one appointment so widgets render data, not "No Data Found".
4. Spot-check the revenue widgets (8, 9): move a test Trial Conversion opp to
   `STUDENT ENROLLED (WON)` and confirm it adds `$160`.

---

## 4. Common gotchas

- **"All Pipelines" is a trap.** Anywhere a widget offers all pipelines (#10,
  #16), manually select only the **5 CIT pipelines**. Legacy pipelines hold
  5,800+ opportunities that will wreck conversion/overview numbers.
- **Revenue uses Trial Conversion + Back to the Mats only** (#8, #9). Adding
  Trial Credit Monitoring double-counts every credit-path enrollment.
- **GHL widget-type names vary** by GHL version (e.g. "Numeric" vs "KPI vs
  Goal" vs "Stat"). Pick the closest single-number widget — the **Config**
  column is what matters, not the exact label.
- **Source vs lead_source.** Widgets 4/22/23/24/25 group by the GHL **native
  Source attribute**, not the `lead_source` custom field. The website now
  writes both — pick *Source* in the widget's group-by/filter dropdown.
