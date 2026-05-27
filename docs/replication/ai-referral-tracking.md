# AI Referral Tracking

This site detects visitors arriving from AI search engines (ChatGPT, Perplexity, Claude, Gemini, etc.) and pushes a custom event to `window.dataLayer` so GA4 can report on AI-driven traffic.

The detection script lives in `src/components/analytics/GTM.astro` and runs on every page (BaseLayout includes it sitewide).

## DataLayer event shape

When a matching referrer is detected, exactly one event is pushed per page load:

```js
{
  event: 'ai_referral',
  ai_engine: 'chatgpt',                       // see "Engines tracked" below
  ai_referrer_url: 'https://chatgpt.com/...', // full document.referrer
  page_path: '/adults'                        // location.pathname
}
```

The push is guarded by `window.__aiReferralLogged` so it fires at most once per page load even if the script is re-executed.

## GTM setup

In your GTM container (the same one referenced by `PUBLIC_GTM_ID`):

### 1. Create Data Layer Variables

Variables -> New -> Variable Type: "Data Layer Variable". Create three:

| Variable name           | Data Layer Variable Name |
| ----------------------- | ------------------------ |
| `dlv - ai_engine`       | `ai_engine`              |
| `dlv - ai_referrer_url` | `ai_referrer_url`        |
| `dlv - page_path`       | `page_path`              |

Leave "Data Layer Version" at 2.

### 2. Create the trigger

Triggers -> New -> Trigger Type: "Custom Event".

- Event name: `ai_referral`
- This trigger fires on: All Custom Events

Name it `CE - ai_referral`.

### 3. Create the GA4 event tag

Tags -> New -> Tag Type: "Google Analytics: GA4 Event".

- Measurement ID / Configuration tag: use your existing GA4 config tag.
- Event Name: `ai_referral`
- Event Parameters:
  | Parameter name    | Value                       |
  | ----------------- | --------------------------- |
  | `ai_engine`       | `{{dlv - ai_engine}}`       |
  | `ai_referrer_url` | `{{dlv - ai_referrer_url}}` |
  | `page_path`       | `{{dlv - page_path}}`       |
- Triggering: attach `CE - ai_referral`.

Name it `GA4 - ai_referral`. Save, then Submit / Publish the container.

### 4. (Recommended) Register `ai_engine` as a custom dimension in GA4

Admin -> Custom definitions -> Create custom dimension:

- Dimension name: `AI Engine`
- Scope: Event
- Event parameter: `ai_engine`

Allow ~24 hours for GA4 to start populating the dimension in reports.

## How to view in GA4

- Real-time: Reports -> Realtime -> filter "Event name" = `ai_referral` to confirm hits while testing.
- Standard reports: Reports -> Engagement -> Events -> click `ai_referral`. Once the custom dimension is registered, you can break down by `AI Engine`.
- Explorations: build a free-form exploration with `ai_engine` as a row and `Event count` / `Sessions` as values for a per-engine breakdown.

### Quick test

In a browser console on any page of the site:

```js
window.dataLayer.push({
  event: 'ai_referral',
  ai_engine: 'chatgpt',
  ai_referrer_url: 'https://chatgpt.com/test',
  page_path: location.pathname,
});
```

The tag should fire in GTM Preview mode and the event should show up in GA4 Realtime.

## Engines tracked

Hostname matching is subdomain-tolerant (`hostname.endsWith(...)`), so `www.` and other subdomain variants are covered.

| Engine label     | Referrer hostnames                                |
| ---------------- | ------------------------------------------------- |
| `chatgpt`        | `chatgpt.com`, `chat.openai.com`                  |
| `perplexity`     | `perplexity.ai` (incl. `www.perplexity.ai`)       |
| `claude`         | `claude.ai`, `claude.com`                         |
| `gemini`         | `gemini.google.com`, `bard.google.com`            |
| `copilot`        | `copilot.microsoft.com`                           |
| `phind`          | `phind.com`                                       |
| `you`            | `you.com`                                         |
| `meta_ai`        | `meta.ai`                                         |
| `duckduckgo_ai`  | `duckduckgo.com` (DDG's AI chat sends users here) |

To add a new engine: edit the `if/else` chain in `src/components/analytics/GTM.astro` and add a row to the table above. No GTM changes needed as long as the event name and parameter names stay the same.
