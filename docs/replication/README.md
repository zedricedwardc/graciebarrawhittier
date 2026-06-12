# Client Replication — AI orientation

This directory holds the AI-readable orchestrator for replicating this
template into a new client instance.

## If you are an AI session

Read in this order:
1. `REPLICATE.md` — the 9-phase procedure you execute
2. `CLIENT_INTAKE.template.md` — the data shape (the operator gives you a filled copy)
3. `../../config/ghl-schema.ts` — source of truth for GHL pipelines/stages/CFs/workflows

Deep-dive references (follow links from REPLICATE.md when needed):
- `./ghl-api-integration-spec.md` — GHL API contract
- `./ghl-onboarding-runbook.md` — long-form runbook (human-readable)
- `./ghl-setup-master-checklist.md` — checklist format
- `./ghl-automation-plan.md` — workflow design
- `./ghl-dashboard-build-guide.md` — UI build steps
- `./launch-checklist.md` — production go-live items
- `./intro-campaign-setup.md` — intro funnel GHL setup
- `./btm-campaign-setup.md` — Back to the Mats campaign GHL setup
- `./blog-setup.md` — website blog GHL setup (PIT scopes, env IDs, custom menu)
- `./ghl-api-access-methods.md` — auth + PIT scopes + Conversation AI endpoints
- `./ghl-workflow-build-from-scratch.md` — internal-backend workflow build
- `./ghl-chat-widget-bot-content.md` — chat widget bot content
- `./sms-bot-prompt-updated.md` — SMS bot Alex prompt
- `./sms-bot-pipeline-orchestration.md` — SMS bot pipeline orchestration
- `./ai-referral-tracking.md` — referral tracking
- `./ad-landing-pages.md` — /go/* standalone ad landing pages (Google Ads + Meta)
- `./images-needed.md` — image assets reference

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