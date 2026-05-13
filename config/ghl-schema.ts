/**
 * GHL automation schema — single source of truth.
 *
 * Used by:
 *   - scripts/onboard-client.ts ........ creates API-creatable assets in a fresh GHL sub-account,
 *                                        prints a UI-checklist for assets that aren't API-creatable.
 *   - src/pages/api/health/ghl.ts ...... verifies live GHL state matches this schema; reports drift.
 *   - src/lib/ghl-pipelines.ts ......... resolves pipeline + stage NAMES → IDs at runtime, cached.
 *   - src/lib/ghl-custom-fields.ts ..... resolves CF fieldKey → ID at runtime, cached.
 *   - src/lib/ghl-adapter.ts ........... references PipelineKey + StageKey to drive workflow logic.
 *
 * Reproducibility contract:
 *   - Code never references pipeline/stage IDs directly. Always go through the schema.
 *   - Adding a new client = clone repo + populate env vars + run onboard script.
 *   - Renaming a stage in GHL UI without updating this file → /api/health/ghl flags drift.
 *
 * What's NOT API-creatable in GHL (per research, 2026-05-08) and must be set up via UI:
 *   - Pipelines + stages
 *   - Contact / Opportunity custom fields
 *   - Workflows (and their inbound webhook URLs)
 *   - Outbound webhook actions inside workflows
 *
 * What IS API-creatable:
 *   - Custom values (account-level globals)
 *   - Tags (implicit on first use)
 *   - Custom field values, opportunities, appointments, notes (data, not schema)
 */

// ─── Pipelines ──────────────────────────────────────────────────────────────

export type PipelineKey = 'LEAD_ACQ' | 'TRIAL_CONV' | 'CREDIT_MON' | 'BACK_TO_MATS';

export interface PipelineDef {
  key: PipelineKey;
  name: string;
  description: string;
  stages: readonly string[]; // in pipeline-view order, top to bottom
  /** Stage that sets the opportunity's GHL `status` to "won". */
  wonStage: string;
  /** Stage(s) that set status to "lost" or "abandoned". */
  lostStages: readonly string[];
}

export const PIPELINES: Record<PipelineKey, PipelineDef> = {
  LEAD_ACQ: {
    key: 'LEAD_ACQ',
    name: 'Lead Acquisition',
    description:
      'Tracks every opt-in until they book their first trial (won) or go cold (lost). One opp per parent contact.',
    stages: [
      'NEW LEAD',
      'TRIAL NURTURE',
      'NURTURE CAMPAIGN',
      'INTRO BOOKED (WON)',
      'LOST / COLD',
    ] as const,
    wonStage: 'INTRO BOOKED (WON)',
    lostStages: ['LOST / COLD'] as const,
  },
  TRIAL_CONV: {
    key: 'TRIAL_CONV',
    name: 'Trial Conversion',
    description:
      'Tracks each booked trial through attendance and conversion. One opp per booked trial (disambiguated by trainee_key).',
    stages: [
      'INTRO BOOKED',
      'TRIAL APPOINTMENT DONE',
      'NO-SHOW',
      'INTRO CLASS REBOOKING',
      'TRIAL ACTIVE NURTURE',
      'TRIAL INACTIVE REACTIVATION',
      'STUDENT ENROLLED (WON)',
      'LOST / COLD',
    ] as const,
    wonStage: 'STUDENT ENROLLED (WON)',
    lostStages: ['LOST / COLD'] as const,
  },
  CREDIT_MON: {
    key: 'CREDIT_MON',
    name: 'Trial Credit Monitoring',
    description:
      'Tracks active-trial students burning their class pass. Multiple opps per contact possible (one per trainee).',
    stages: [
      'CREDIT ACTIVE',
      'ANOTHER TRIAL BOOKED',
      'APPOINTMENT TODAY',
      'ATTENDED APPOINTMENT',
      'NO-SHOW',
      'CREDITS EXHAUSTED',
      'REACTIVATION',
      'WON ENROLLED',
      'LOST',
    ] as const,
    wonStage: 'WON ENROLLED',
    lostStages: ['LOST'] as const,
  },
  BACK_TO_MATS: {
    key: 'BACK_TO_MATS',
    name: 'Back to the Mats',
    description:
      'Tracks former students through the 30-day re-enrollment campaign. One opp per parent contact (multi-trainee bookings happen at booking time and are tracked downstream in TRIAL_CONV). Stage names match the live GHL pipeline (spaces, not hyphens, in two-word stages).',
    stages: [
      'FORMER STUDENT',
      'RE ENROLLMENT CLASS BOOKED',
      'APPOINTMENT TODAY',
      'NO-SHOW',
      'RE ENROLLED',
      'OFFER EXPIRED',
    ] as const,
    wonStage: 'RE ENROLLED',
    lostStages: ['OFFER EXPIRED'] as const,
  },
} as const;

// ─── Custom Fields ──────────────────────────────────────────────────────────
// GHL DOES expose a public API to create Contact + Opportunity custom fields:
//   POST /locations/{locationId}/customFields  (scope: locations/customFields.write)
// The onboard script's `provision` mode creates them automatically. Folders for
// these fields are still UI-only.
//
// fieldKey naming: GHL auto-generates `<model>.<snake_case_of_label>` from the
// label, e.g. label "Trainee Key" + model "contact" → fieldKey
// "contact.trainee_key". Our schema's fieldKey is the unprefixed bare name; the
// runtime resolver in src/lib/ghl-custom-fields.ts strips the model. prefix
// when matching.

export type CustomFieldType = 'TEXT' | 'NUMBER' | 'DATE' | 'TEXTAREA' | 'DROPDOWN_SINGLE';

export interface CustomFieldDef {
  fieldKey: string;
  label: string;
  type: CustomFieldType;
  description: string;
  setBy: 'webhook' | 'workflow' | 'admin';
}

export const CONTACT_CUSTOM_FIELDS: readonly CustomFieldDef[] = [
  {
    fieldKey: 'last_trainee_key',
    label: 'Last Trainee Key',
    type: 'TEXT',
    description: 'Slug of the most recent trainee booked from this contact (e.g. eli-20210315).',
    setBy: 'webhook',
  },
  {
    fieldKey: 'household_trainee_keys',
    label: 'Household Trainee Keys',
    type: 'TEXTAREA',
    description: 'Comma-separated list of trainee_keys belonging to this contact.',
    setBy: 'webhook',
  },
  {
    fieldKey: 'lead_source',
    label: 'Lead Source',
    type: 'TEXT',
    description: 'Most recent form source (homepage-optin, kids-optin, adults-optin, contact-form).',
    setBy: 'webhook',
  },
  {
    fieldKey: 'last_page',
    label: 'Last Page',
    type: 'TEXT',
    description: 'Path of the last page they submitted from.',
    setBy: 'webhook',
  },
  {
    fieldKey: 'last_idempotency_key',
    label: 'Last Idempotency Key',
    type: 'TEXT',
    description: 'Last webhook idempotency key processed for this contact (24h dedupe).',
    setBy: 'webhook',
  },
  {
    // GHL auto-generates the fieldKey from the label by snake-casing it,
    // so "Back to the Mats Imported At" becomes "back_to_the_mats_…" with
    // "the" preserved. The schema fieldKey must match GHL's actual key.
    fieldKey: 'back_to_the_mats_imported_at',
    label: 'Back to the Mats Imported At',
    type: 'DATE',
    description: 'Datetime the contact was bulk-imported into the Back to the Mats campaign. Used for dedupe (skip re-import if recent) and audit.',
    setBy: 'admin',
  },
] as const;
// Note: credits_remaining + last_decrement_trial_date moved to OPPORTUNITY_CUSTOM_FIELDS
// because each trainee has an independent trial pass. Putting them on Contact would mean
// siblings share one credit count.

export const OPPORTUNITY_CUSTOM_FIELDS: readonly CustomFieldDef[] = [
  {
    fieldKey: 'trainee_key',
    label: 'Trainee Key',
    type: 'TEXT',
    description: 'Identity of the trainee this opp tracks. Used for sibling/rebook disambiguation.',
    setBy: 'webhook',
  },
  {
    fieldKey: 'trainee_first_name',
    label: 'Trainee First Name',
    type: 'TEXT',
    description: 'Display name of the trainee.',
    setBy: 'webhook',
  },
  {
    fieldKey: 'trainee_dob',
    label: 'Trainee DOB',
    type: 'DATE',
    description: 'Used for age-based program assignment.',
    setBy: 'webhook',
  },
  {
    fieldKey: 'program',
    label: 'Program',
    type: 'TEXT',
    description: 'Program key (kids, juniors, adults).',
    setBy: 'webhook',
  },
  {
    fieldKey: 'last_appointment_id',
    label: 'Last Appointment ID',
    type: 'TEXT',
    description: 'GHL appointment ID of the most recent booking on this opp.',
    setBy: 'webhook',
  },
  {
    fieldKey: 'last_appointment_start_iso',
    label: 'Last Appointment Start ISO',
    type: 'DATE',
    description: 'ISO datetime of the most recent appointment.',
    setBy: 'webhook',
  },
  {
    fieldKey: 'appointment_history',
    label: 'Appointment History',
    type: 'TEXTAREA',
    description: 'Comma-separated list of all appointment IDs this opp has owned.',
    setBy: 'webhook',
  },
  {
    fieldKey: 'credits_remaining',
    label: 'Credits Remaining',
    type: 'NUMBER',
    description: 'Source of truth for this trainee\'s trial pass count. Per-opp so siblings have independent counts. Decremented by webhook handler.',
    setBy: 'workflow',
  },
  {
    fieldKey: 'last_decrement_trial_date',
    label: 'Last Decrement Trial Date',
    type: 'DATE',
    description: 'Idempotency guard — last trial_date_iso for which credits were decremented on this opp.',
    setBy: 'workflow',
  },
  {
    fieldKey: 'last_attendance_iso',
    label: 'Last Attendance ISO',
    type: 'DATE',
    description: 'When this trainee last attended a class. Used for idle-timeout triggers.',
    setBy: 'workflow',
  },
  {
    fieldKey: 'rebook_link_token',
    label: 'Rebook Link Token',
    type: 'TEXT',
    description: 'HMAC-signed magic-link token for /rebook page. Generated at trial activation, 90-day expiry.',
    setBy: 'workflow',
  },
] as const;

// ─── Custom Values (account-level globals, admin-editable) ──────────────────

export interface CustomValueDef {
  fieldKey: string;
  name: string;
  defaultValue: string;
  description: string;
}

export const CUSTOM_VALUES: readonly CustomValueDef[] = [
  {
    fieldKey: 'trial_credits_default',
    name: 'Trial Credits Default',
    defaultValue: '3',
    description: 'How many credits to grant on first trial attendance.',
  },
  {
    fieldKey: 'new_lead_to_trial_nurture_hours',
    name: 'NEW LEAD → TRIAL NURTURE timeout (hours)',
    defaultValue: '24',
    description: 'Auto-move from NEW LEAD to TRIAL NURTURE if no booking after this many hours.',
  },
  {
    fieldKey: 'trial_nurture_to_nurture_campaign_days',
    name: 'TRIAL NURTURE → NURTURE CAMPAIGN timeout (days)',
    defaultValue: '7',
    description: 'How long the Trial Nurture campaign runs before pushing to last-chance Nurture Campaign.',
  },
  {
    fieldKey: 'nurture_campaign_to_lost_days',
    name: 'NURTURE CAMPAIGN → LOST/COLD timeout (days)',
    defaultValue: '14',
    description: 'How long the last-chance Nurture Campaign runs before marking the lead LOST/COLD.',
  },
  {
    fieldKey: 'no_show_to_rebooking_minutes',
    name: 'NO-SHOW → INTRO CLASS REBOOKING delay (minutes)',
    defaultValue: '5',
    description: 'Short delay so admin can correct an accidental NO-SHOW before rebooking campaign fires.',
  },
  {
    fieldKey: 'rebooking_to_inactive_days',
    name: 'INTRO CLASS REBOOKING → TRIAL INACTIVE REACTIVATION timeout (days)',
    defaultValue: '14',
    description: 'How long the rebooking campaign runs before giving up.',
  },
  {
    fieldKey: 'inactive_reactivation_to_lost_days',
    name: 'TRIAL INACTIVE REACTIVATION → LOST timeout (days)',
    defaultValue: '21',
    description: 'How long the reactivation campaign runs before marking lost.',
  },
  {
    fieldKey: 'credit_active_to_reactivation_days',
    name: 'CREDIT ACTIVE → REACTIVATION timeout (days)',
    defaultValue: '14',
    description: 'How long the another-trial campaign runs before pushing to reactivation.',
  },
  {
    fieldKey: 'credit_reactivation_to_lost_days',
    name: 'CREDIT REACTIVATION → LOST timeout (days)',
    defaultValue: '21',
    description: 'How long the credit-reactivation campaign runs before marking lost.',
  },

  // ─── Reproducibility helpers ─────────────────────────────────────────
  // These let workflow webhook configs reference values via merge tags
  // ({{ custom_values.X }}) instead of pasting URLs/secrets directly.
  // Onboarding a new client = update these 2 values once in GHL UI.
  {
    // GHL auto-generates fieldKey from name → custom_values.website_webhook_base_url
    fieldKey: 'website_webhook_base_url',
    name: 'Website Webhook Base URL',
    defaultValue: '',
    description: 'Base URL of the website webhooks (no trailing slash). E.g. https://YOUR-DOMAIN.com/api/webhooks/ghl. Workflows append /stage-changed, /credit-stage-changed, /appointment-status. Reference in workflow URL field as: {{custom_values.website_webhook_base_url}}/stage-changed',
  },
  {
    fieldKey: 'website_webhook_secret',
    name: 'Website Webhook Secret',
    defaultValue: '',
    description: 'Shared secret sent as X-GBW-Secret header on backflow webhooks. Must match GHL_WEBHOOK_SECRET in the website Vercel env. Reference in workflow custom-header value as: {{custom_values.website_webhook_secret}}',
  },

  // ─── Back to the Mats campaign ───────────────────────────────────────
  {
    fieldKey: 'back_to_the_mats_deadline',
    name: 'Back to the Mats Deadline',
    defaultValue: '',
    description: 'Human-readable deadline label rendered in BTM email/SMS bodies (e.g. "Friday, June 8, 2026"). Update before every campaign run. Must align with PUBLIC_BACK_TO_MATS_DEADLINE_ISO in the website Vercel env (the website auto-formats from the ISO; this value is for GHL message merge).',
  },
  {
    fieldKey: 'back_to_the_mats_page_url',
    name: 'Back to the Mats Page URL',
    defaultValue: 'https://gbwhittier.com/back-to-the-mats',
    description: 'Landing-page URL referenced in every BTM email/SMS. Hardcoded in the page; this value is for GHL message merge.',
  },
  {
    fieldKey: 'back_to_the_mats_offer_name',
    name: 'Back to the Mats Offer Name',
    defaultValue: 'Back to the Mats Special',
    description: 'Display name of the offer used in subject lines / body copy.',
  },
  // NOTE: BTM FORMER STUDENT → OFFER EXPIRED (30d) and NO-SHOW → OFFER EXPIRED
  // (14d) used to live here as tunable custom values. They were removed because
  // the Wait + Update Stage steps are configured with literal day counts inside
  // the BTM workflows in GHL — no merge tag, nothing reads them at runtime. Edit
  // the day count inside the workflow if you need to change it.
] as const;

// ─── Workflows ──────────────────────────────────────────────────────────────
// All workflow IDs are discovered at install time and stored in env vars.
// Trigger types are documented here so the onboard checklist tells the operator
// exactly how to configure each workflow in GHL UI.

export type WorkflowTrigger =
  | { type: 'manual_enroll' }
  | { type: 'opp_stage_changed'; pipelineKey: PipelineKey; enterStage: string }
  | { type: 'opp_stage_any'; pipelineKey: PipelineKey }
  | { type: 'appointment_status_changed'; calendarFilter: 'all' | string }
  | { type: 'webhook_inbound'; description: string };

export interface WorkflowDef {
  envVarKey: string; // env var that holds this workflow's ID after onboarding
  name: string;
  description: string;
  trigger: WorkflowTrigger;
  /**
   * Whether the workflow contains a webhook-action step that calls back to our website.
   * If true, the workflow MUST set the X-GBW-Secret header in that step.
   */
  callsWebsiteWebhook: false | { path: string };
}

export const WORKFLOWS: readonly WorkflowDef[] = [
  // ─── Lead Acquisition campaigns ─────────────────────────────────────────
  {
    envVarKey: 'WORKFLOW_ID_TRIAL_NURTURE',
    name: 'Trial Nurture Campaign',
    description: 'Email/SMS sequence inviting NEW LEAD contacts to book their first trial. Runs for 7 days. Contact is removed from this workflow by the website on successful booking (see exitNurtureWorkflows in src/lib/ghl-adapter.ts).',
    trigger: { type: 'opp_stage_changed', pipelineKey: 'LEAD_ACQ', enterStage: 'TRIAL NURTURE' },
    callsWebsiteWebhook: false,
  },
  {
    envVarKey: 'WORKFLOW_ID_NURTURE_CAMPAIGN',
    name: 'Last Chance Nurture Campaign',
    description: 'Final-push sequence for leads who didn\'t book during Trial Nurture. Runs for 14 days. Contact is removed from this workflow by the website on successful booking (see exitNurtureWorkflows in src/lib/ghl-adapter.ts).',
    trigger: { type: 'opp_stage_changed', pipelineKey: 'LEAD_ACQ', enterStage: 'NURTURE CAMPAIGN' },
    callsWebsiteWebhook: false,
  },
  {
    envVarKey: 'WORKFLOW_ID_QUARTERLY_REACTIVATION',
    name: 'Quarterly Reactivation Tag',
    description: 'Adds the `quarterly-reactivation` tag to LOST/COLD contacts, picked up by separate quarterly winback workflow.',
    trigger: { type: 'opp_stage_changed', pipelineKey: 'LEAD_ACQ', enterStage: 'LOST / COLD' },
    callsWebsiteWebhook: false,
  },

  // ─── Trial Conversion campaigns ─────────────────────────────────────────
  {
    envVarKey: 'WORKFLOW_ID_PRE_TRIAL_REMINDERS',
    name: 'Pre-Trial Reminders',
    description: '24h-before + 2h-before SMS/email reminders for the first trial appointment.',
    trigger: { type: 'appointment_status_changed', calendarFilter: 'all' },
    callsWebsiteWebhook: false,
  },
  {
    envVarKey: 'WORKFLOW_ID_REBOOKING_CAMPAIGN',
    name: 'Intro Class Rebooking Campaign',
    description: 'Email/SMS sequence pushing NO-SHOW leads to rebook. Runs for 14 days. Contact is removed from this workflow by the website on successful rebook (see exitNurtureWorkflows in src/lib/ghl-adapter.ts).',
    trigger: { type: 'opp_stage_changed', pipelineKey: 'TRIAL_CONV', enterStage: 'INTRO CLASS REBOOKING' },
    callsWebsiteWebhook: false,
  },
  {
    envVarKey: 'WORKFLOW_ID_INACTIVE_REACTIVATION',
    name: 'Trial Inactive Reactivation Campaign',
    description: 'Reactivation sequence for trials that went cold without enrolling. Runs for 21 days. Contact is removed from this workflow by the website on successful rebook (see exitNurtureWorkflows in src/lib/ghl-adapter.ts).',
    trigger: { type: 'opp_stage_changed', pipelineKey: 'TRIAL_CONV', enterStage: 'TRIAL INACTIVE REACTIVATION' },
    callsWebsiteWebhook: false,
  },
  {
    envVarKey: 'WORKFLOW_ID_90_DAY_REVIEW',
    name: '90-Day Review Campaign',
    description: 'Post-enrollment review/feedback sequence. Same workflow used by both pipelines\' WON stages.',
    trigger: { type: 'manual_enroll' },
    callsWebsiteWebhook: false,
  },

  // ─── Trial Credit Monitoring campaigns ─────────────────────────────────
  {
    envVarKey: 'WORKFLOW_ID_ANOTHER_TRIAL_CAMPAIGN',
    name: 'Another Trial Booking Campaign',
    description: 'Invites active-trial students to book their next class on their pass. Includes magic /rebook link. Contact is removed from this workflow by the website on successful rebook (see exitNurtureWorkflows in src/lib/ghl-adapter.ts).',
    trigger: { type: 'opp_stage_changed', pipelineKey: 'CREDIT_MON', enterStage: 'CREDIT ACTIVE' },
    callsWebsiteWebhook: false,
  },
  {
    envVarKey: 'WORKFLOW_ID_REBOOK_REMINDERS',
    name: 'Rebooking Reminders',
    description: '24h + 2h reminders for ANOTHER TRIAL BOOKED appointments.',
    trigger: { type: 'opp_stage_changed', pipelineKey: 'CREDIT_MON', enterStage: 'ANOTHER TRIAL BOOKED' },
    callsWebsiteWebhook: false,
  },
  {
    envVarKey: 'WORKFLOW_ID_NO_SHOW_MESSAGE',
    name: 'Credit-Pipeline No-Show Message',
    description: 'Sends a single message after a credit-pipeline NO-SHOW.',
    trigger: { type: 'opp_stage_changed', pipelineKey: 'CREDIT_MON', enterStage: 'NO-SHOW' },
    callsWebsiteWebhook: false,
  },
  {
    envVarKey: 'WORKFLOW_ID_CREDITS_EXHAUSTED',
    name: 'Credits Exhausted Notification',
    description: 'Notifies the customer their free pass is fully used. Pushes for membership.',
    trigger: { type: 'opp_stage_changed', pipelineKey: 'CREDIT_MON', enterStage: 'CREDITS EXHAUSTED' },
    callsWebsiteWebhook: false,
  },
  {
    envVarKey: 'WORKFLOW_ID_CREDIT_REACTIVATION',
    name: 'Trial Active Reactivation Campaign',
    description: 'Reactivation sequence for credit-pipeline students who went idle. Contact is removed from this workflow by the website on successful rebook (see exitNurtureWorkflows in src/lib/ghl-adapter.ts).',
    trigger: { type: 'opp_stage_changed', pipelineKey: 'CREDIT_MON', enterStage: 'REACTIVATION' },
    callsWebsiteWebhook: false,
  },

  // ─── Backflow webhooks (GHL → website) ─────────────────────────────────
  {
    envVarKey: 'WORKFLOW_ID_TRIAL_CONV_STAGE_WEBHOOK',
    name: '[Backflow] Trial Conversion stage changed → website webhook',
    description: 'Fires POST /api/webhooks/ghl/stage-changed on every Trial Conversion stage change. MUST include X-GBW-Secret header.',
    trigger: { type: 'opp_stage_any', pipelineKey: 'TRIAL_CONV' },
    callsWebsiteWebhook: { path: '/api/webhooks/ghl/stage-changed' },
  },
  {
    envVarKey: 'WORKFLOW_ID_CREDIT_STAGE_WEBHOOK',
    name: '[Backflow] Trial Credit Monitoring stage changed → website webhook',
    description: 'Fires POST /api/webhooks/ghl/credit-stage-changed on every Credit Monitoring stage change. MUST include X-GBW-Secret header.',
    trigger: { type: 'opp_stage_any', pipelineKey: 'CREDIT_MON' },
    callsWebsiteWebhook: { path: '/api/webhooks/ghl/credit-stage-changed' },
  },
  {
    envVarKey: 'WORKFLOW_ID_APPT_STATUS_WEBHOOK',
    name: '[Backflow] Appointment status changed → website webhook',
    description: 'Fires POST /api/webhooks/ghl/appointment-status when appointment status flips (e.g. cancelled in GHL UI). MUST include X-GBW-Secret header.',
    trigger: { type: 'appointment_status_changed', calendarFilter: 'all' },
    callsWebsiteWebhook: { path: '/api/webhooks/ghl/appointment-status' },
  },
  {
    envVarKey: 'WORKFLOW_ID_BOT_BOOKING_ORCHESTRATOR',
    name: '[Backflow] Bot Booking → Pipeline Orchestrator',
    description: 'Invoked by the SMS AI booking bot via its `Trigger a Workflow` action at the end of every successful appointment booking. Fires POST /api/webhooks/ghl/agent-booking-completed so the website runs handleBooking() — creates Trial Conversion opp, moves Lead Acquisition opp to INTRO BOOKED (WON), sets trainee CFs, adds audit notes. MUST include X-GBW-Secret header.',
    trigger: { type: 'webhook_inbound', description: 'Triggered by bot action; no native GHL trigger type — workflow exposes a manual-invocation entry point.' },
    callsWebsiteWebhook: { path: '/api/webhooks/ghl/agent-booking-completed' },
  },

  // ─── Back to the Mats campaigns ─────────────────────────────────────
  {
    envVarKey: 'WORKFLOW_ID_BTM_30DAY',
    name: 'BTM 30-Day Campaign',
    description: '30-day re-enrollment campaign for former students. 9 emails + 3 SMS per docx Part 2. Website /api/book removes the contact from this workflow on successful BTM booking (handleBtmBooking → exitNurtureWorkflows). Wait + Update Stage to OFFER EXPIRED at the end (configured inside the workflow itself, 30 days).',
    trigger: { type: 'opp_stage_changed', pipelineKey: 'BACK_TO_MATS', enterStage: 'FORMER STUDENT' },
    callsWebsiteWebhook: false,
  },
  {
    envVarKey: 'WORKFLOW_ID_BTM_CONFIRMATION',
    name: 'BTM Appointment Confirmation',
    description: '3 emails + 2 SMS confirming a booked re-enrollment session. Per docx Part 3. Triggers on opp moving to RE-ENROLLMENT CLASS BOOKED.',
    trigger: { type: 'opp_stage_changed', pipelineKey: 'BACK_TO_MATS', enterStage: 'RE-ENROLLMENT CLASS BOOKED' },
    callsWebsiteWebhook: false,
  },
  {
    envVarKey: 'WORKFLOW_ID_BTM_REBOOKING',
    name: 'BTM Re-Booking Campaign (no-show)',
    description: '14-day re-booking nudge campaign for no-shows. 4 emails + 1 SMS per docx Part 4. Website /api/book removes the contact from this workflow on successful BTM booking (handleBtmBooking → exitNurtureWorkflows). Wait + Update Stage to OFFER EXPIRED at the end (configured inside the workflow itself, 14 days).',
    trigger: { type: 'opp_stage_changed', pipelineKey: 'BACK_TO_MATS', enterStage: 'NO-SHOW' },
    callsWebsiteWebhook: false,
  },

  // Note: Stage auto-progression timers (NEW LEAD → TRIAL NURTURE, etc.) are NOT separate
  // workflows. They're declared natively in STAGE_TRANSITIONS via `auto_move_after` actions
  // and implemented inside the campaign workflows themselves (Wait + Update Opp Stage step).
] as const;

// ─── Tags ───────────────────────────────────────────────────────────────────
// Tags are created implicitly in GHL when first applied via API — no setup step needed.
// Listed here so the onboard checklist documents them and so search/filter UIs are consistent.

export const TAGS: readonly { name: string; description: string }[] = [
  { name: 'kickstart-funnel', description: 'Any contact who entered via the website kickstart flow.' },
  { name: 'source-homepage-optin', description: 'Opted in via the homepage form.' },
  { name: 'source-kids-optin', description: 'Opted in via /kids-martial-arts.' },
  { name: 'source-adults-optin', description: 'Opted in via /adults-jiu-jitsu.' },
  { name: 'source-contact-form', description: 'Submitted the /contact form (not an opt-in but tagged for source attribution).' },
  { name: 'quarterly-reactivation', description: 'LOST/COLD lead — picked up by quarterly winback campaign.' },
  { name: 'back-to-the-mats-import', description: 'Bulk-imported via CSV into the Back to the Mats campaign. Source attribution.' },
  { name: 'source-agent-booking', description: 'Set on the contact by the agent-booking-completed webhook after the SMS bot books an appointment. Differentiates bot-driven bookings from page-driven ones in reporting.' },
] as const;

// ─── Env var manifest ───────────────────────────────────────────────────────
// Authoritative list of every env var the integration depends on.
// Used by /api/health/ghl to verify nothing is missing on boot.

export interface EnvVarDef {
  key: string;
  required: boolean;
  description: string;
  example?: string;
}

export const ENV_VARS: readonly EnvVarDef[] = [
  { key: 'GHL_PIT_TOKEN', required: true, description: 'GHL Private Integration Token.' },
  { key: 'GHL_LOCATION_ID', required: true, description: 'GHL sub-account ID.' },
  { key: 'GHL_WEBHOOK_SECRET', required: true, description: 'Shared secret for X-GBW-Secret header on inbound webhooks.' },
  { key: 'CANCEL_SIGNING_KEY', required: true, description: 'HMAC key for /api/cancel tokens.' },
  { key: 'REBOOK_SIGNING_KEY', required: true, description: 'HMAC key for /rebook page magic-link tokens.' },
  { key: 'HEALTH_KEY', required: true, description: 'Gates /api/health/ghl from public access.' },

  { key: 'PIPELINE_ID_LEAD_ACQ', required: true, description: 'Discovered at onboard time.' },
  { key: 'PIPELINE_ID_TRIAL_CONV', required: true, description: 'Discovered at onboard time.' },
  { key: 'PIPELINE_ID_CREDIT_MON', required: true, description: 'Discovered at onboard time.' },
  { key: 'PIPELINE_ID_BACK_TO_MATS', required: false, description: 'Discovered at BTM-campaign onboard time. Optional — when empty, /api/book skips the BTM detection path entirely (graceful degradation while pipeline is being set up).' },

  // Workflow IDs — one per WORKFLOWS entry
  ...WORKFLOWS.map(
    (w): EnvVarDef => ({
      key: w.envVarKey,
      required: true,
      description: `Workflow ID for: ${w.name}`,
    }),
  ),

  // Calendar IDs (already exist in current .env)
  { key: 'GHL_CAL_TINY', required: true, description: 'Calendar ID for Tiny Champs program (trial flow).' },
  { key: 'GHL_CAL_LC1', required: true, description: 'Calendar ID for Little Champs 1 program (trial flow).' },
  { key: 'GHL_CAL_LC2', required: true, description: 'Calendar ID for Little Champs 2 program (trial flow).' },
  { key: 'GHL_CAL_JUNIORS', required: true, description: 'Calendar ID for Juniors BJJ program (trial flow).' },
  { key: 'GHL_CAL_ADULTS', required: true, description: 'Calendar ID for Adults BJJ program (trial flow).' },

  // BTM-flow calendar IDs (separate from trial calendars so admin sees BTM bookings independently)
  { key: 'GHL_CAL_BTM_TINY', required: false, description: 'Calendar ID for Tiny Champs program (Back to the Mats flow). Optional until BTM campaign launches.' },
  { key: 'GHL_CAL_BTM_LC1', required: false, description: 'Calendar ID for Little Champs 1 program (BTM flow).' },
  { key: 'GHL_CAL_BTM_LC2', required: false, description: 'Calendar ID for Little Champs 2 program (BTM flow).' },
  { key: 'GHL_CAL_BTM_JUNIORS', required: false, description: 'Calendar ID for Juniors BJJ program (BTM flow).' },
  { key: 'GHL_CAL_BTM_ADULTS', required: false, description: 'Calendar ID for Adults BJJ program (BTM flow).' },

  // NOTE: BTM campaign deadline lives in the `back_to_the_mats_deadline` GHL
  // custom value (read at request time via src/lib/ghl-custom-values.ts) so
  // the studio admin can update it via Settings → Custom Values in GHL —
  // no env var, no redeploy required.

  { key: 'IDEMPOTENCY_BACKEND', required: false, description: 'memory (default) | upstash. Use upstash for cold-start durability.' },
  { key: 'KV_REST_API_URL', required: false, description: 'Upstash REST URL when IDEMPOTENCY_BACKEND=upstash.' },
  { key: 'KV_REST_API_TOKEN', required: false, description: 'Upstash REST token when IDEMPOTENCY_BACKEND=upstash.' },
] as const;

// ─── Stage transition rules (declarative) ──────────────────────────────────
// Read by webhook handlers to decide what to do when a stage change fires.
// Declarative form means renaming a stage in GHL UI + updating PIPELINES above
// is enough — no scattered hardcoded stage names in handler code.

/**
 * TransitionAction — the verbs the stage-transition dispatcher knows how to execute.
 *
 * Implicit semantics:
 *   - All `auto_move_*` actions cancel automatically if the opportunity exits the stage
 *     before the timer fires. This is the only sensible default; an "absolute" timer that
 *     keeps running after a stage change would always be a bug.
 *   - `decrement_credits` is idempotent — guarded by the `last_decrement_trial_date`
 *     contact field. Re-entry to the same stage with the same trial date is a no-op.
 */
export type TransitionAction =
  /** Wait N units (per Custom Value), then move to target stage. Cancels on stage exit. */
  | { type: 'auto_move_after'; targetStage: string; afterCustomValueKey: string }
  /** Move to target stage immediately on entry. Used to chain transient stages. */
  | { type: 'auto_move_immediate'; targetStage: string }
  /** Wait until the linked appointment's end time, then move to target stage. */
  | { type: 'auto_move_at_appointment_end'; targetStage: string }
  /** Wait until the morning of the linked appointment's date, then move to target stage. */
  | { type: 'auto_move_on_appointment_day'; targetStage: string }
  /** Create a new opp in another pipeline (used as cross-pipeline entry point). */
  | { type: 'create_opp'; targetPipeline: PipelineKey; targetStage: string }
  /** Find the contact's other-pipeline opp and move it (e.g. push Lead Acq back to nurture). */
  | { type: 'cross_pipeline_move'; targetPipeline: PipelineKey; targetStage: string }
  /** Enroll contact in a workflow (campaign, reminders, etc.). */
  | { type: 'fire_workflow'; workflowEnvVarKey: string }
  | { type: 'add_tag'; tagName: string }
  | { type: 'set_status'; status: 'won' | 'lost' | 'abandoned' }
  /** Set Contact.credits_remaining (canonical source of truth). */
  | { type: 'set_credits'; value: number | 'default' }
  /**
   * Decrement Contact.credits_remaining by 1, but only if `last_decrement_trial_date` ≠
   * the opp's `last_appointment_start_iso` (so re-entering the stage with the same trial
   * doesn't double-decrement). Handler then conditionally moves opp:
   *   - credits_remaining > 0 → CREDIT ACTIVE
   *   - credits_remaining === 0 → CREDITS EXHAUSTED
   * The conditional move is handler-side, not declarative — it's specific enough that
   * generalizing it would add complexity for one use case.
   */
  | { type: 'decrement_credits'; idempotencyKey: 'last_decrement_trial_date' }
  | { type: 'add_audit_note'; templateKey: string };

export interface StageTransition {
  pipelineKey: PipelineKey;
  enterStage: string;
  actions: readonly TransitionAction[];
}

export const STAGE_TRANSITIONS: readonly StageTransition[] = [
  // ─── Lead Acquisition ──────────────────────────────────────────────────
  {
    pipelineKey: 'LEAD_ACQ',
    enterStage: 'NEW LEAD',
    actions: [
      {
        type: 'auto_move_after',
        targetStage: 'TRIAL NURTURE',
        afterCustomValueKey: 'new_lead_to_trial_nurture_hours',
      },
    ],
  },
  {
    pipelineKey: 'LEAD_ACQ',
    enterStage: 'TRIAL NURTURE',
    actions: [
      { type: 'fire_workflow', workflowEnvVarKey: 'WORKFLOW_ID_TRIAL_NURTURE' },
      {
        type: 'auto_move_after',
        targetStage: 'NURTURE CAMPAIGN',
        afterCustomValueKey: 'trial_nurture_to_nurture_campaign_days',
      },
    ],
  },
  {
    pipelineKey: 'LEAD_ACQ',
    enterStage: 'NURTURE CAMPAIGN',
    actions: [
      { type: 'fire_workflow', workflowEnvVarKey: 'WORKFLOW_ID_NURTURE_CAMPAIGN' },
      {
        type: 'auto_move_after',
        targetStage: 'LOST / COLD',
        afterCustomValueKey: 'nurture_campaign_to_lost_days',
      },
    ],
  },
  {
    pipelineKey: 'LEAD_ACQ',
    enterStage: 'INTRO BOOKED (WON)',
    actions: [{ type: 'set_status', status: 'won' }],
  },
  {
    pipelineKey: 'LEAD_ACQ',
    enterStage: 'LOST / COLD',
    actions: [
      { type: 'set_status', status: 'lost' },
      { type: 'add_tag', tagName: 'quarterly-reactivation' },
    ],
  },

  // ─── Trial Conversion ──────────────────────────────────────────────────
  {
    pipelineKey: 'TRIAL_CONV',
    enterStage: 'INTRO BOOKED',
    actions: [
      { type: 'fire_workflow', workflowEnvVarKey: 'WORKFLOW_ID_PRE_TRIAL_REMINDERS' },
      { type: 'add_audit_note', templateKey: 'intro_booked' },
      // Auto-move to TRIAL APPOINTMENT DONE so admin sees a daily classify-list.
      { type: 'auto_move_at_appointment_end', targetStage: 'TRIAL APPOINTMENT DONE' },
    ],
  },
  // TRIAL APPOINTMENT DONE = admin-driven, no auto-action
  {
    pipelineKey: 'TRIAL_CONV',
    enterStage: 'NO-SHOW',
    actions: [
      { type: 'auto_move_after', targetStage: 'INTRO CLASS REBOOKING', afterCustomValueKey: 'no_show_to_rebooking_minutes' },
    ],
  },
  {
    pipelineKey: 'TRIAL_CONV',
    enterStage: 'INTRO CLASS REBOOKING',
    actions: [
      { type: 'fire_workflow', workflowEnvVarKey: 'WORKFLOW_ID_REBOOKING_CAMPAIGN' },
      { type: 'auto_move_after', targetStage: 'TRIAL INACTIVE REACTIVATION', afterCustomValueKey: 'rebooking_to_inactive_days' },
    ],
  },
  {
    pipelineKey: 'TRIAL_CONV',
    enterStage: 'TRIAL ACTIVE NURTURE',
    actions: [
      { type: 'create_opp', targetPipeline: 'CREDIT_MON', targetStage: 'CREDIT ACTIVE' },
      { type: 'set_credits', value: 'default' },
    ],
  },
  {
    pipelineKey: 'TRIAL_CONV',
    enterStage: 'TRIAL INACTIVE REACTIVATION',
    actions: [
      { type: 'fire_workflow', workflowEnvVarKey: 'WORKFLOW_ID_INACTIVE_REACTIVATION' },
      { type: 'auto_move_after', targetStage: 'LOST / COLD', afterCustomValueKey: 'inactive_reactivation_to_lost_days' },
    ],
  },
  {
    pipelineKey: 'TRIAL_CONV',
    enterStage: 'STUDENT ENROLLED (WON)',
    actions: [
      { type: 'set_status', status: 'won' },
      { type: 'fire_workflow', workflowEnvVarKey: 'WORKFLOW_ID_90_DAY_REVIEW' },
    ],
  },
  {
    pipelineKey: 'TRIAL_CONV',
    enterStage: 'LOST / COLD',
    actions: [
      { type: 'set_status', status: 'lost' },
      { type: 'cross_pipeline_move', targetPipeline: 'LEAD_ACQ', targetStage: 'NURTURE CAMPAIGN' },
    ],
  },

  // ─── Trial Credit Monitoring ───────────────────────────────────────────
  {
    pipelineKey: 'CREDIT_MON',
    enterStage: 'CREDIT ACTIVE',
    actions: [
      { type: 'fire_workflow', workflowEnvVarKey: 'WORKFLOW_ID_ANOTHER_TRIAL_CAMPAIGN' },
      { type: 'auto_move_after', targetStage: 'REACTIVATION', afterCustomValueKey: 'credit_active_to_reactivation_days' },
    ],
  },
  {
    pipelineKey: 'CREDIT_MON',
    enterStage: 'ANOTHER TRIAL BOOKED',
    actions: [
      { type: 'fire_workflow', workflowEnvVarKey: 'WORKFLOW_ID_REBOOK_REMINDERS' },
      // Auto-move to APPOINTMENT TODAY at 00:01 on the day of the appointment
      // so admin sees a daily list of "appointments today to classify."
      { type: 'auto_move_on_appointment_day', targetStage: 'APPOINTMENT TODAY' },
    ],
  },
  // APPOINTMENT TODAY = admin-driven, no auto-action
  {
    pipelineKey: 'CREDIT_MON',
    enterStage: 'ATTENDED APPOINTMENT',
    actions: [
      // Idempotent — guarded by contact.last_decrement_trial_date.
      // Handler conditionally moves opp post-decrement:
      //   credits_remaining > 0  → CREDIT ACTIVE
      //   credits_remaining = 0  → CREDITS EXHAUSTED
      { type: 'decrement_credits', idempotencyKey: 'last_decrement_trial_date' },
    ],
  },
  {
    pipelineKey: 'CREDIT_MON',
    enterStage: 'NO-SHOW',
    actions: [
      { type: 'fire_workflow', workflowEnvVarKey: 'WORKFLOW_ID_NO_SHOW_MESSAGE' },
      { type: 'auto_move_immediate', targetStage: 'CREDIT ACTIVE' },
    ],
  },
  {
    pipelineKey: 'CREDIT_MON',
    enterStage: 'CREDITS EXHAUSTED',
    actions: [
      { type: 'fire_workflow', workflowEnvVarKey: 'WORKFLOW_ID_CREDITS_EXHAUSTED' },
    ],
  },
  {
    pipelineKey: 'CREDIT_MON',
    enterStage: 'REACTIVATION',
    actions: [
      { type: 'fire_workflow', workflowEnvVarKey: 'WORKFLOW_ID_CREDIT_REACTIVATION' },
      { type: 'auto_move_after', targetStage: 'LOST', afterCustomValueKey: 'credit_reactivation_to_lost_days' },
    ],
  },
  {
    pipelineKey: 'CREDIT_MON',
    enterStage: 'WON ENROLLED',
    actions: [
      { type: 'set_status', status: 'won' },
      { type: 'fire_workflow', workflowEnvVarKey: 'WORKFLOW_ID_90_DAY_REVIEW' },
    ],
  },
  {
    pipelineKey: 'CREDIT_MON',
    enterStage: 'LOST',
    actions: [
      { type: 'set_status', status: 'lost' },
      { type: 'set_credits', value: 0 },
      { type: 'cross_pipeline_move', targetPipeline: 'LEAD_ACQ', targetStage: 'NURTURE CAMPAIGN' },
    ],
  },

  // ─── Back to the Mats ─────────────────────────────────────────────────
  {
    pipelineKey: 'BACK_TO_MATS',
    enterStage: 'FORMER STUDENT',
    actions: [
      { type: 'fire_workflow', workflowEnvVarKey: 'WORKFLOW_ID_BTM_30DAY' },
      // Wait 30 days → move to OFFER EXPIRED is configured inside the workflow itself.
    ],
  },
  {
    pipelineKey: 'BACK_TO_MATS',
    enterStage: 'RE ENROLLMENT CLASS BOOKED',
    actions: [
      { type: 'fire_workflow', workflowEnvVarKey: 'WORKFLOW_ID_BTM_CONFIRMATION' },
      // Mirrors TRIAL_CONV pattern — daily classify list at appointment-day morning.
      { type: 'auto_move_on_appointment_day', targetStage: 'APPOINTMENT TODAY' },
    ],
  },
  // APPOINTMENT TODAY = admin-driven (NO-SHOW or RE ENROLLED). No auto-action.
  {
    pipelineKey: 'BACK_TO_MATS',
    enterStage: 'NO-SHOW',
    actions: [
      { type: 'fire_workflow', workflowEnvVarKey: 'WORKFLOW_ID_BTM_REBOOKING' },
      // Wait 14 days → move to OFFER EXPIRED is configured inside the workflow itself.
    ],
  },
  {
    pipelineKey: 'BACK_TO_MATS',
    enterStage: 'RE ENROLLED',
    actions: [
      { type: 'set_status', status: 'won' },
      { type: 'fire_workflow', workflowEnvVarKey: 'WORKFLOW_ID_90_DAY_REVIEW' },
    ],
  },
  {
    pipelineKey: 'BACK_TO_MATS',
    enterStage: 'OFFER EXPIRED',
    actions: [
      { type: 'set_status', status: 'lost' },
    ],
  },
] as const;

// ─── Schema export (single object for tooling consumption) ─────────────────

export const GHL_SCHEMA = {
  pipelines: PIPELINES,
  contactCustomFields: CONTACT_CUSTOM_FIELDS,
  opportunityCustomFields: OPPORTUNITY_CUSTOM_FIELDS,
  customValues: CUSTOM_VALUES,
  workflows: WORKFLOWS,
  tags: TAGS,
  envVars: ENV_VARS,
  stageTransitions: STAGE_TRANSITIONS,
} as const;

export type GhlSchema = typeof GHL_SCHEMA;
