/**
 * Domain orchestrator. The ONLY thing endpoints call into for GHL operations.
 *
 * Each handler is the source of truth for a lifecycle event:
 *   - handleOptIn:        opt-in form submission (Phase 2)
 *   - handleBooking:      initial trial booking + rebook detection (Phase 3)
 *   - handleAttendance:   admin moves opp to TRIAL ATTENDED → activate credits (Phase 4)
 *   - handleCreditDecrement: admin moves opp to ATTENDED APPOINTMENT (Phase 4)
 *   - handleCancellation: customer or admin cancels (Phase 4)
 *
 * Returns a result envelope including the contact ID, opportunity ID, and a
 * structured GHL call log for observability.
 */

import {
  upsertContact,
  updateContact,
  addContactTags,
  addContactToWorkflow,
  addContactNote,
  getContact,
  type ContactRecord,
} from './ghl';
import {
  findOpps,
  createOpp,
  updateOppFields,
  moveStage,
  findByTraineeKey,
  setOppStatus,
  getOppCfValue,
} from './ghl-opportunities';
import { cfPayload } from './ghl-custom-fields';
import { deriveTraineeKey } from './trainee-key';
import { readEnv } from './ghl';
import { signRebookToken } from './rebook-token';

export type OptInSource = 'homepage-optin' | 'kids-optin' | 'adults-optin' | 'contact-form';

export interface HandleOptInInput {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  source: OptInSource;
  message?: string;
  trainee?: {
    firstName: string;
    lastName?: string;
    /** YYYY-MM-DD. */
    dob?: string;
    program?: 'kids' | 'juniors' | 'adults';
    isSelf?: boolean;
  };
  page: string;
}

export interface HandleOptInResult {
  contactId: string;
  opportunityId: string | null;
  isNewContact: boolean;
  traineeKey: string | null;
}

/**
 * Handle an opt-in form submission.
 *
 * Side effects (in order):
 *   1. Upsert Contact by email + phone
 *   2. PUT contact custom fields: lead_source (overwrite), last_page,
 *      last_trainee_key (if trainee data), credits_remaining (if empty),
 *      household_trainee_keys (append-if-new)
 *   3. Tag contact with `source-${source}`
 *   4. Find Lead Acquisition opp; if none, create at NEW LEAD
 *   5. Enroll in Lead Nurture workflow (skipped for contact-form source)
 *
 * The schema's STAGE_TRANSITIONS for NEW LEAD does the rest (auto-move to
 * TRIAL NURTURE after 24h via the campaign workflow's wait+update step).
 */
export async function handleOptIn(input: HandleOptInInput): Promise<HandleOptInResult> {
  const traineeKey = input.trainee
    ? deriveTraineeKey({
        isSelf: input.trainee.isSelf ?? false,
        firstName: input.trainee.firstName,
        lastName: input.trainee.lastName ?? input.lastName,
        dob: input.trainee.dob,
      })
    : null;

  // 1. Upsert contact
  const contactId = await upsertContact({
    firstName: input.firstName,
    lastName: input.lastName,
    email: input.email,
    phone: input.phone,
  });

  // We need to know whether to initialize credits_remaining. Fetch existing
  // contact to read current state — single round-trip; small price for correctness.
  const existing = await getContact(contactId);
  const isNewContact = !existing || readCfNumber(existing, 'credits_remaining') === undefined;

  // 2. Build CF patch
  const cfMap: Record<string, string | number | boolean | null> = {
    lead_source: input.source,
    last_page: input.page,
  };
  if (traineeKey) {
    cfMap.last_trainee_key = traineeKey;
    cfMap.household_trainee_keys = appendIfNew(
      readCfString(existing, 'household_trainee_keys') ?? '',
      traineeKey,
    );
  }
  if (isNewContact) {
    const defaultCredits = Number(readEnv('TRIAL_CREDITS_DEFAULT') ?? '3');
    cfMap.credits_remaining = Number.isFinite(defaultCredits) ? defaultCredits : 3;
  }

  const customFields = await cfPayload('contact', cfMap);
  await updateContact(contactId, { customFields });

  // 3. Tag for source attribution
  await addContactTags(contactId, ['kickstart-funnel', `source-${input.source}`]);

  // 4. Lead Acquisition opportunity
  let opportunityId: string | null = null;
  const existingOpps = await findOpps({
    contactId,
    pipelineKey: 'LEAD_ACQ',
    status: 'open',
    limit: 5,
  });

  if (existingOpps.length > 0) {
    // Refresh CFs on existing opp; don't move stage (the timer/workflow handles that)
    const opp = existingOpps[0]!;
    opportunityId = opp.id;
    const oppCfs = await cfPayload('opportunity', {
      trainee_key: traineeKey ?? '',
      trainee_first_name: input.trainee?.firstName ?? '',
      program: input.trainee?.program ?? '',
    });
    if (oppCfs.length > 0) await updateOppFields(opp.id, oppCfs);
  } else {
    const oppName = input.trainee?.firstName
      ? `${input.trainee.firstName} ${input.lastName} — ${input.source}`
      : `${input.firstName} ${input.lastName} — ${input.source}`;
    const oppCfs = traineeKey
      ? await cfPayload('opportunity', {
          trainee_key: traineeKey,
          trainee_first_name: input.trainee?.firstName ?? '',
          program: input.trainee?.program ?? '',
        })
      : [];
    const opp = await createOpp({
      pipelineKey: 'LEAD_ACQ',
      stageName: 'NEW LEAD',
      contactId,
      name: oppName,
      source: input.source,
      customFields: oppCfs,
    });
    opportunityId = opp.id;
  }

  // 5. Enroll in nurture workflow (skip for contact-form leads)
  if (input.source !== 'contact-form') {
    const workflowId = readEnv('WORKFLOW_ID_TRIAL_NURTURE');
    if (workflowId) await addContactToWorkflow(contactId, workflowId);
  } else {
    // Contact form: notify staff via existing admin workflow if configured
    const adminWf = readEnv('WORKFLOW_ID_ADMIN_NOTIFICATION');
    if (adminWf) await addContactToWorkflow(contactId, adminWf);
    if (input.message) {
      await addContactNote(contactId, `Contact form message: ${input.message}`);
    }
  }

  return { contactId, opportunityId, isNewContact, traineeKey };
}

// ─── helpers ───────────────────────────────────────────────────────────────

function readCfString(contact: ContactRecord | null, fieldKey: string): string | undefined {
  if (!contact?.customFields) return undefined;
  for (const cf of contact.customFields) {
    if (cf.key === fieldKey || (cf as { fieldKey?: string }).fieldKey === fieldKey) {
      const v = cf.field_value ?? cf.value;
      if (typeof v === 'string') return v;
    }
  }
  return undefined;
}

function readCfNumber(contact: ContactRecord | null, fieldKey: string): number | undefined {
  if (!contact?.customFields) return undefined;
  for (const cf of contact.customFields) {
    if (cf.key === fieldKey || (cf as { fieldKey?: string }).fieldKey === fieldKey) {
      const v = cf.field_value ?? cf.value;
      if (typeof v === 'number') return v;
      if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
    }
  }
  return undefined;
}

function appendIfNew(existing: string, item: string): string {
  const items = new Set(
    existing
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
  items.add(item);
  return Array.from(items).join(',');
}

// ─── handleBooking ─────────────────────────────────────────────────────────

export interface HandleBookingInput {
  contactId: string;
  appointmentId: string;
  parent: { firstName: string; lastName: string; email: string; phone: string };
  trainee: { firstName: string; lastName?: string; dob?: string; age: number; isSelf: boolean };
  program: 'tiny' | 'lc1' | 'lc2' | 'juniors' | 'adults';
  programName: string;
  slotStartISO: string;
  slotEndISO: string;
}

export interface HandleBookingResult {
  contactId: string;
  opportunityId: string;
  isRebook: boolean;
  /** Stage the Trial Conversion opp landed at (always INTRO BOOKED for now). */
  stage: string;
}

/**
 * Handle a successful initial-trial booking. Called from /api/book after the
 * contact is upserted and the appointment is created.
 *
 * Two paths:
 *   1. INITIAL TRIAL: no existing Trial Conversion opp matches trainee_key
 *        → create Trial Conv opp at INTRO BOOKED
 *        → move Lead Acquisition opp to INTRO BOOKED (WON)
 *   2. REBOOK (after no-show / inactive): existing Trial Conv opp found
 *        → update existing opp, move stage back to INTRO BOOKED
 *        → don't touch Lead Acq (already won, or skip if missing)
 *
 * Active-trial rebooks (Credit Monitoring pipeline) are handled separately
 * by the handleRebook function in /api/book — that path uses a magic-link
 * session token and only updates the credit pipeline.
 */
export async function handleBooking(input: HandleBookingInput): Promise<HandleBookingResult> {
  const traineeKey = deriveTraineeKey({
    isSelf: input.trainee.isSelf,
    firstName: input.trainee.firstName,
    lastName: input.trainee.lastName ?? input.parent.lastName,
    dob: input.trainee.dob,
  });

  // Update contact CFs to reflect this booking (last_trainee_key + household)
  const contact = await getContact(input.contactId);
  const householdRaw = readCfString(contact, 'household_trainee_keys') ?? '';
  const contactCfs = await cfPayload('contact', {
    last_trainee_key: traineeKey,
    household_trainee_keys: appendIfNew(householdRaw, traineeKey),
  });
  await updateContact(input.contactId, { customFields: contactCfs });

  // Pre-POST rebook detection: search Trial Conversion opps for this contact
  const existingOpps = await findOpps({
    contactId: input.contactId,
    pipelineKey: 'TRIAL_CONV',
    status: 'open',
    limit: 20,
  });
  const existingOpp = findByTraineeKey(existingOpps, traineeKey);

  const oppName = input.trainee.isSelf
    ? `${input.parent.firstName} ${input.parent.lastName}`
    : `${input.trainee.firstName} ${input.parent.lastName}`;

  // ─── Branch A: rebook (existing Trial Conv opp found) ────────────────
  if (existingOpp) {
    const oppCfs = await cfPayload('opportunity', {
      trainee_key: traineeKey,
      trainee_first_name: input.trainee.firstName,
      program: input.program,
      last_appointment_id: input.appointmentId,
      last_appointment_start_iso: input.slotStartISO,
    });
    const updated = await moveStage({
      oppId: existingOpp.id,
      pipelineKey: 'TRIAL_CONV',
      stageName: 'INTRO BOOKED',
      customFields: oppCfs,
    });
    await addContactNote(
      input.contactId,
      `Re-booked ${input.programName} on ${input.slotStartISO} (opp ${updated.id} → INTRO BOOKED).`,
    );
    return { contactId: input.contactId, opportunityId: updated.id, isRebook: true, stage: 'INTRO BOOKED' };
  }

  // ─── Branch B: initial trial — create new Trial Conv opp ─────────────
  const oppCfs = await cfPayload('opportunity', {
    trainee_key: traineeKey,
    trainee_first_name: input.trainee.firstName,
    trainee_dob: input.trainee.dob ?? '',
    program: input.program,
    last_appointment_id: input.appointmentId,
    last_appointment_start_iso: input.slotStartISO,
    appointment_history: input.appointmentId,
  });
  const created = await createOpp({
    pipelineKey: 'TRIAL_CONV',
    stageName: 'INTRO BOOKED',
    contactId: input.contactId,
    name: oppName,
    source: input.program,
    customFields: oppCfs,
  });

  // Move Lead Acquisition opp → INTRO BOOKED (WON). Best-effort: missing opp is
  // a recoverable state (walk-in book without prior opt-in), not an error.
  try {
    const leadOpps = await findOpps({
      contactId: input.contactId,
      pipelineKey: 'LEAD_ACQ',
      status: 'open',
      limit: 5,
    });
    const leadOpp = leadOpps[0];
    if (leadOpp) {
      await moveStage({
        oppId: leadOpp.id,
        pipelineKey: 'LEAD_ACQ',
        stageName: 'INTRO BOOKED (WON)',
      });
    }
  } catch (err) {
    // Don't fail the booking if Lead Acq move fails — opp creation succeeded.
    console.warn('[handleBooking] Lead Acq stage move failed (non-fatal)', err);
  }

  await addContactNote(
    input.contactId,
    `First trial booked: ${input.programName} on ${input.slotStartISO} (opp ${created.id}).`,
  );

  return { contactId: input.contactId, opportunityId: created.id, isRebook: false, stage: 'INTRO BOOKED' };
}

// ─── handleAttendance ──────────────────────────────────────────────────────
// Fired when admin moves a Trial Conversion opp to TRIAL ACTIVE NURTURE.
// Creates (or updates) the Trial Credit Monitoring opp at CREDIT ACTIVE,
// initializes credits from Custom Value, and mints a 90-day rebook token.

export interface HandleAttendanceInput {
  contactId: string;
  /** trainee_key from the Trial Conversion opp (read from its CFs by the webhook handler). */
  traineeKey: string;
  /** trainee first name (for opp name + audit). */
  traineeFirstName: string;
  /** Optional: parent's last name for opp display. */
  parentLastName?: string;
  /** Program key from the Trial Conv opp's CFs. */
  program?: string;
  /** ISO datetime of the trial that just attended (for last_attendance_iso). */
  lastTrialDateISO: string;
}

export interface HandleAttendanceResult {
  creditOppId: string;
  isNewCreditOpp: boolean;
  creditsRemaining: number;
  rebookLinkToken: string;
}

export async function handleAttendance(input: HandleAttendanceInput): Promise<HandleAttendanceResult> {
  // Initialize credits if contact doesn't have any yet (defensive).
  const contact = await getContact(input.contactId);
  let credits = readCfNumber(contact, 'credits_remaining');
  if (credits === undefined || credits <= 0) {
    const defaultCredits = Number(readEnv('TRIAL_CREDITS_DEFAULT') ?? '3');
    credits = Number.isFinite(defaultCredits) ? defaultCredits : 3;
    const contactCfs = await cfPayload('contact', { credits_remaining: credits });
    await updateContact(input.contactId, { customFields: contactCfs });
  }

  // Find existing Credit Monitoring opp matching trainee_key
  const existing = await findOpps({
    contactId: input.contactId,
    pipelineKey: 'CREDIT_MON',
    status: 'open',
    limit: 20,
  });
  const existingCredit = findByTraineeKey(existing, input.traineeKey);

  // Mint a magic-link rebook token (90 day expiry)
  const rebookLinkToken = signRebookToken({
    contactId: input.contactId,
    traineeKey: input.traineeKey,
  });

  const oppName = input.parentLastName
    ? `${input.traineeFirstName} ${input.parentLastName}`
    : input.traineeFirstName;

  const oppCfs = await cfPayload('opportunity', {
    trainee_key: input.traineeKey,
    trainee_first_name: input.traineeFirstName,
    program: input.program ?? '',
    credits_remaining_display: credits,
    last_attendance_iso: input.lastTrialDateISO,
    rebook_link_token: rebookLinkToken,
  });

  if (existingCredit) {
    // Existing credit opp — refresh CFs + ensure stage is CREDIT ACTIVE
    await moveStage({
      oppId: existingCredit.id,
      pipelineKey: 'CREDIT_MON',
      stageName: 'CREDIT ACTIVE',
      customFields: oppCfs,
    });
    await addContactNote(
      input.contactId,
      `Trial attended ${input.lastTrialDateISO} — credit opp refreshed (credits: ${credits}).`,
    );
    return {
      creditOppId: existingCredit.id,
      isNewCreditOpp: false,
      creditsRemaining: credits,
      rebookLinkToken,
    };
  }

  // New credit opp at CREDIT ACTIVE
  const created = await createOpp({
    pipelineKey: 'CREDIT_MON',
    stageName: 'CREDIT ACTIVE',
    contactId: input.contactId,
    name: oppName,
    customFields: oppCfs,
  });
  await addContactNote(
    input.contactId,
    `Trial credits activated (${credits}) for ${input.traineeFirstName} after attending on ${input.lastTrialDateISO}.`,
  );
  return {
    creditOppId: created.id,
    isNewCreditOpp: true,
    creditsRemaining: credits,
    rebookLinkToken,
  };
}

// ─── handleCreditDecrement ─────────────────────────────────────────────────
// Fired when admin moves a Credit Monitoring opp to ATTENDED APPOINTMENT.
// Decrements credits_remaining (idempotency-guarded by last_decrement_trial_date).
// Then conditionally moves opp:
//   credits_remaining > 0  → CREDIT ACTIVE
//   credits_remaining = 0  → CREDITS EXHAUSTED

export interface HandleCreditDecrementInput {
  contactId: string;
  oppId: string;
  /** trial date ISO read from the Credit opp's last_appointment_start_iso. */
  trialDateISO: string;
  /** trainee key for audit context. */
  traineeKey?: string;
}

export interface HandleCreditDecrementResult {
  contactId: string;
  oppId: string;
  /** Credits remaining AFTER decrement (or before if no-op). */
  creditsRemaining: number;
  /** Stage opp ended up at: CREDIT ACTIVE, CREDITS EXHAUSTED, or unchanged on no-op. */
  endStage: string;
  /** True if the decrement was actually applied (false = idempotent no-op). */
  wasDecremented: boolean;
}

export async function handleCreditDecrement(input: HandleCreditDecrementInput): Promise<HandleCreditDecrementResult> {
  const contact = await getContact(input.contactId);
  const lastDecrement = readCfString(contact, 'last_decrement_trial_date');

  // Idempotency guard — same trial date already decremented? No-op.
  if (lastDecrement && lastDecrement === input.trialDateISO) {
    const credits = readCfNumber(contact, 'credits_remaining') ?? 0;
    return {
      contactId: input.contactId,
      oppId: input.oppId,
      creditsRemaining: credits,
      endStage: 'ATTENDED APPOINTMENT',
      wasDecremented: false,
    };
  }

  const before = readCfNumber(contact, 'credits_remaining') ?? 0;
  const after = Math.max(0, before - 1);

  // Persist new credit count + idempotency marker
  const contactCfs = await cfPayload('contact', {
    credits_remaining: after,
    last_decrement_trial_date: input.trialDateISO,
  });
  await updateContact(input.contactId, { customFields: contactCfs });

  // Mirror to opp display + decide next stage
  const nextStage = after > 0 ? 'CREDIT ACTIVE' : 'CREDITS EXHAUSTED';
  const oppCfs = await cfPayload('opportunity', {
    credits_remaining_display: after,
    last_attendance_iso: input.trialDateISO,
  });
  await moveStage({
    oppId: input.oppId,
    pipelineKey: 'CREDIT_MON',
    stageName: nextStage,
    customFields: oppCfs,
  });

  await addContactNote(
    input.contactId,
    `Class attended ${input.trialDateISO} — credits ${before} → ${after} (opp moved to ${nextStage}).`,
  );

  return {
    contactId: input.contactId,
    oppId: input.oppId,
    creditsRemaining: after,
    endStage: nextStage,
    wasDecremented: true,
  };
}

// ─── handleCancellation ────────────────────────────────────────────────────
// Customer cancellation (via /api/cancel) OR admin cancellation (via GHL UI
// status change picked up by /api/webhooks/ghl/appointment-status).

export interface HandleCancellationInput {
  contactId: string;
  appointmentId: string;
  reason?: string;
  source: 'customer' | 'admin';
  /** True if the appointment status was already updated by the trigger
   *  (admin path) — we only update opp + audit in that case. */
  appointmentAlreadyCancelled?: boolean;
}

export interface HandleCancellationResult {
  contactId: string;
  /** Trial Conversion opp ID we marked abandoned (if found). */
  trialConvOppId?: string;
}

export async function handleCancellation(input: HandleCancellationInput): Promise<HandleCancellationResult> {
  // Find the matching Trial Conversion opp that owns this appointment_id
  const opps = await findOpps({
    contactId: input.contactId,
    pipelineKey: 'TRIAL_CONV',
    status: 'open',
    limit: 20,
  });
  const matchingOpp = opps.find((o) => {
    const apptId = getOppCfValue<string>(o, 'last_appointment_id');
    return apptId === input.appointmentId;
  });

  if (matchingOpp) {
    await setOppStatus(matchingOpp.id, 'abandoned');
  }

  await addContactNote(
    input.contactId,
    `Cancellation by ${input.source}: appointment ${input.appointmentId}${input.reason ? ` — reason: ${input.reason}` : ''}`,
  );

  // Optional follow-up workflow
  const cancelWf = readEnv('WORKFLOW_ID_CANCEL_FOLLOWUP');
  if (cancelWf) await addContactToWorkflow(input.contactId, cancelWf);

  return { contactId: input.contactId, trialConvOppId: matchingOpp?.id };
}
