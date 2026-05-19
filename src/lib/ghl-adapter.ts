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
  removeContactFromWorkflow,
  addContactNote,
  getContact,
  deleteOpportunity,
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
  getOppCfValueByKey,
} from './ghl-opportunities';
import { cfPayload } from './ghl-custom-fields';
import { channelForSource, pageLabelForSource, type LeadSource } from './lead-types';
import { deriveTraineeKey } from './trainee-key';
import { readEnv, GhlError, type OpportunityRecord } from './ghl';
import { getStageId } from './ghl-pipelines';
import { signRebookToken } from './rebook-token';
import {
  APPOINTMENT_STATUS_TRANSITIONS,
  type PipelineKey,
  type ApptOutcome,
  type ApptStatusTransition,
} from '../../config/ghl-schema';

/** Resolve `stageName` to its GHL ID and compare against the opp's current stage. */
async function isAtStage(opp: OpportunityRecord, pipelineKey: PipelineKey, stageName: string): Promise<boolean> {
  if (!opp.pipelineStageId) return false;
  const stageId = await getStageId(pipelineKey, stageName);
  return opp.pipelineStageId === stageId;
}

/** Page-level opt-in source slug. Registry of values lives in lead-types.ts. */
export type OptInSource = LeadSource;

export interface HandleOptInInput {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  source: LeadSource;
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
 *   1. Upsert Contact by email + phone, setting the native `source` attribute
 *      to the dashboard lead channel (Website) for the native Lead Source report
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

  // 1. Upsert contact. The native `source` attribute is set to the dashboard
  // lead channel so GHL's native Lead Source report attributes the contact
  // correctly; the page-level slug is kept separately in the lead_source CF.
  const contactId = await upsertContact({
    firstName: input.firstName,
    lastName: input.lastName,
    email: input.email,
    phone: input.phone,
    source: channelForSource(input.source),
  });

  // Read existing contact to detect whether household_trainee_keys needs an append.
  const existing = await getContact(contactId);
  const isNewContact = !existing;

  // 2. Build CF patch (credits now live on Trial Credit Monitoring opp, not contact).
  // lead_source = internal slug; optin_page = human-readable page sub-layer
  // (the second reporting layer beneath the native `source` channel above).
  const cfMap: Record<string, string | number | boolean | null> = {
    lead_source: input.source,
    optin_page: pageLabelForSource(input.source),
    last_page: input.page,
  };
  if (traineeKey) {
    cfMap.last_trainee_key = traineeKey;
    cfMap.household_trainee_keys = appendIfNew(
      readCfString(existing, 'household_trainee_keys') ?? '',
      traineeKey,
    );
  }

  // Set the native `source` on this PUT too — `/contacts/upsert` only writes
  // `source` when it *creates* a contact, so an existing contact (e.g. a family
  // member already in GHL) would keep a stale/blank source otherwise. The PUT
  // reliably overwrites it, guaranteeing the Lead Source report is correct.
  const customFields = await cfPayload('contact', cfMap);
  await updateContact(contactId, { source: channelForSource(input.source), customFields });

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

/**
 * YYYY-MM-DD of an ISO datetime in America/Los_Angeles. Written to the opp's
 * `appointment_date` DATE field so GHL workflow filters like "Appointment Date
 * is today" compare cleanly — using a full ISO datetime drifts across the
 * UTC/Los Angeles boundary (an 11pm PT slot reads as next-day UTC).
 */
export function toAcademyLocalDate(iso: string): string {
  // en-CA produces YYYY-MM-DD; locale chosen for format, not language.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
}

/**
 * Format an ISO datetime as a human-readable string in America/Los_Angeles.
 * "2026-05-13T11:00:00-07:00" → "Wed, May 13 at 11:00 AM"
 * Used in audit notes that admins read in GHL.
 */
function formatTrialTime(iso: string | undefined | null): string {
  if (!iso) return 'unknown time';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso; // fall back to raw if unparseable
  const date = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(d);
  const time = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    hour: 'numeric',
    minute: '2-digit',
  }).format(d);
  return `${date} at ${time}`;
}

/** "Eli (5)" or "Sarah" depending on isSelf and whether age is set. */
function formatTraineeLabel(firstName: string, age: number | undefined, isSelf: boolean): string {
  if (isSelf) return firstName;
  if (age && age > 0 && age < 100) return `${firstName} (age ${age})`;
  return firstName;
}

/**
 * Remove the contact from every active nurture-campaign workflow on the given
 * funnel. Called after a successful booking — the contact's opp has just moved
 * off the nurture stage, so any in-flight nurture sequence should stop.
 *
 * GHL workflows are contact-scoped, so this removes ALL of this contact's
 * active enrollments in each listed workflow. For the rare multi-trainee-in-
 * same-pipeline case this is an over-exit — accepted as a pragmatic trade-off
 * (the alternative is a contact getting nurture messages AFTER they booked,
 * which reads as unprofessional).
 *
 * Non-fatal: failures are logged and swallowed. The booking already succeeded;
 * a stray nurture message is recoverable, a thrown error here is not.
 */
export async function exitNurtureWorkflows(
  contactId: string,
  funnel: 'trial' | 'credit' | 'btm' | 'revival',
): Promise<void> {
  let envKeys: string[];
  if (funnel === 'trial') {
    envKeys = ['WORKFLOW_ID_TRIAL_NURTURE', 'WORKFLOW_ID_NURTURE_CAMPAIGN', 'WORKFLOW_ID_REBOOKING_CAMPAIGN', 'WORKFLOW_ID_INACTIVE_REACTIVATION'];
  } else if (funnel === 'credit') {
    envKeys = ['WORKFLOW_ID_ANOTHER_TRIAL_CAMPAIGN', 'WORKFLOW_ID_CREDIT_REACTIVATION'];
  } else if (funnel === 'btm') {
    envKeys = ['WORKFLOW_ID_BTM_30DAY', 'WORKFLOW_ID_BTM_REBOOKING'];
  } else {
    envKeys = ['WORKFLOW_ID_REVIVAL_30DAY_DRIP'];
  }
  await Promise.all(envKeys.map(async (key) => {
    const wfId = readEnv(key);
    if (!wfId) return;
    try {
      await removeContactFromWorkflow(contactId, wfId);
    } catch (err) {
      console.warn(`[exitNurtureWorkflows] ${key} removal failed (non-fatal)`, err);
    }
  }));
}

/**
 * Move the contact's open Revival Protocol opp (if any) to BOOKED + mark won.
 * No-op when the contact isn't in the revival funnel — graceful for any
 * non-revival booking that still flows through the same booking handler.
 *
 * Best-effort: all failures are logged and swallowed. The downstream Trial
 * Conversion opp is already created by handleTrialBooking — a stale Revival
 * opp is recoverable, a thrown error here is not.
 */
export async function moveRevivalOppToBooked(contactId: string): Promise<void> {
  if (!readEnv('PIPELINE_ID_REVIVAL')) return; // not provisioned yet
  try {
    const opps = await findOpps({
      contactId,
      pipelineKey: 'REVIVAL',
      status: 'open',
      limit: 5,
    });
    if (opps.length === 0) return;
    for (const opp of opps) {
      try {
        await moveStage({ oppId: opp.id, pipelineKey: 'REVIVAL', stageName: 'BOOKED' });
        await setOppStatus(opp.id, 'won');
      } catch (err) {
        console.warn('[moveRevivalOppToBooked] move/status failed (non-fatal)', { oppId: opp.id, err });
      }
    }
  } catch (err) {
    console.warn('[moveRevivalOppToBooked] lookup failed (non-fatal)', err);
  }
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
  /**
   * Booking flow context — selects which pipeline pathway runs. Strict
   * separation: each value picks ONE handler that touches ONE pipeline
   * family, with no cross-contamination.
   *   - 'trial' (default, /kickstart) → handleTrialBooking → LEAD_ACQ + TRIAL_CONV
   *   - 'btm' (/back-to-the-mats) → handleBtmBooking → BACK_TO_MATS only
   */
  flow?: 'trial' | 'btm';
}

export interface HandleBookingResult {
  contactId: string;
  opportunityId: string;
  isRebook: boolean;
  /** Stage the Trial Conversion opp landed at (always INTRO BOOKED for now). */
  stage: string;
}

/**
 * Handle a successful booking. Dispatches to one of two completely
 * independent paths based on the flow:
 *
 *   - flow="trial" (default, /kickstart) → handleTrialBooking()
 *       Touches LEAD_ACQ + TRIAL_CONV. Existing trial-funnel behavior.
 *
 *   - flow="btm" (/back-to-the-mats) → handleBtmBooking()
 *       Touches BACK_TO_MATS only. Never creates LEAD_ACQ or TRIAL_CONV
 *       opps. Re-enrollment campaign is its own funnel — separate
 *       reporting, separate workflows, no cross-contamination.
 *
 * Both paths share only the upstream side effects in /api/book (contact
 * upsert, appointment creation) and the contact-level CF update below.
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

  // Universal contact-CF update — both flows want this for trainee tracking.
  const contact = await getContact(input.contactId);
  const householdRaw = readCfString(contact, 'household_trainee_keys') ?? '';
  const contactCfs = await cfPayload('contact', {
    last_trainee_key: traineeKey,
    household_trainee_keys: appendIfNew(householdRaw, traineeKey),
  });
  await updateContact(input.contactId, { customFields: contactCfs });

  // Dispatch on flow — strict separation, no shared opp logic past this point.
  if (input.flow === 'btm') {
    return handleBtmBooking(input, traineeKey);
  }
  return handleTrialBooking(input, traineeKey);
}

// ─── BTM booking path ──────────────────────────────────────────────────────
/**
 * Back to the Mats booking handler. Touches ONLY the BACK_TO_MATS pipeline.
 *
 * Per-trainee model: each booking creates its own BTM opp keyed by
 * trainee_key. The first booking from a parent contact also DELETES that
 * contact's FORMER STUDENT opp (the one created at CSV import) so the
 * pipeline view doesn't show both an unconverted parent + their trainee
 * opps simultaneously.
 *
 * Branches:
 *   A. This trainee already has a BTM opp (matched by trainee_key)
 *        → move it to RE ENROLLMENT CLASS BOOKED (rebook of same trainee)
 *        → does NOT touch the parent's FORMER STUDENT opp — it was already
 *          consumed by the first booking
 *   B. This is a new trainee for the contact
 *        → DELETE the contact's FORMER STUDENT opp (if it exists)
 *        → CREATE a new per-trainee BTM opp at RE ENROLLMENT CLASS BOOKED,
 *          with trainee_key/trainee_first_name/program/last_appointment_id CFs
 *
 * Both branches DELETE the contact's enrollment in the BTM 30-day and
 * re-booking workflows (so they stop receiving nurture messaging post-
 * booking) and add an audit note.
 *
 * Never creates anything in LEAD_ACQ or TRIAL_CONV — those are the trial
 * funnel's responsibility, not BTM's.
 */
async function handleBtmBooking(
  input: HandleBookingInput,
  traineeKey: string,
): Promise<HandleBookingResult> {
  // Soft-fail when the BTM pipeline isn't provisioned yet.
  if (!readEnv('PIPELINE_ID_BACK_TO_MATS')) {
    console.warn('[handleBtmBooking] PIPELINE_ID_BACK_TO_MATS unset — skipping BTM ops');
    return { contactId: input.contactId, opportunityId: '', isRebook: false, stage: 'NO_PIPELINE' };
  }

  // Opp name includes program + trainee age so multi-trainee bookings under
  // one contact produce visibly distinct opp cards in the pipeline view AND
  // never collide on the GHL "Allow Duplicate Opportunity" check (which keys
  // off opp name + contact + pipeline).
  const oppName = input.trainee.isSelf
    ? `${input.parent.firstName} ${input.parent.lastName} — ${input.programName} (${input.trainee.age})`
    : `${input.trainee.firstName} ${input.parent.lastName} — ${input.programName} (${input.trainee.age})`;

  console.log('[handleBtmBooking] start', {
    contactId: input.contactId,
    appointmentId: input.appointmentId,
    program: input.program,
    traineeKey,
    oppName,
  });

  // Read all open BTM opps for this contact in one round-trip.
  let btmOpps;
  try {
    btmOpps = await findOpps({
      contactId: input.contactId,
      pipelineKey: 'BACK_TO_MATS',
      status: 'open',
      limit: 20,
    });
    console.log('[handleBtmBooking] findOpps result', {
      contactId: input.contactId,
      count: btmOpps.length,
      ids: btmOpps.map((o) => o.id),
    });
  } catch (err) {
    console.warn('[handleBtmBooking] findOpps failed (non-fatal)', err);
    return { contactId: input.contactId, opportunityId: '', isRebook: false, stage: 'BTM_LOOKUP_FAILED' };
  }

  // ─── Branch A: rebook of an existing trainee ────────────────────────
  // Opps for this trainee_key get moved back to RE ENROLLMENT CLASS BOOKED
  // (e.g. they no-showed and now re-booked).
  const existingTraineeOpp = await findByTraineeKey(btmOpps, traineeKey);
  if (existingTraineeOpp) {
    console.log('[handleBtmBooking] BRANCH_A rebook — moving existing opp', {
      oppId: existingTraineeOpp.id,
      traineeKey,
    });
    try {
      const oppCfs = await cfPayload('opportunity', {
        trainee_key: traineeKey,
        trainee_first_name: input.trainee.firstName,
        program: input.program,
        last_appointment_id: input.appointmentId,
        last_appointment_start_iso: input.slotStartISO,
        appointment_date: toAcademyLocalDate(input.slotStartISO),
      });
      await moveStage({
        oppId: existingTraineeOpp.id,
        pipelineKey: 'BACK_TO_MATS',
        stageName: 'RE ENROLLMENT CLASS BOOKED',
        customFields: oppCfs,
      });
      await exitNurtureWorkflows(input.contactId, 'btm');
    } catch (err) {
      console.warn('[handleBtmBooking] rebook stage move failed (non-fatal)', err);
    }
    return { contactId: input.contactId, opportunityId: existingTraineeOpp.id, isRebook: true, stage: 'RE ENROLLMENT CLASS BOOKED' };
  }

  // ─── Branch B: new trainee — delete FORMER STUDENT opp + create trainee opp ─
  // The parent's FORMER STUDENT opp (if any) gets removed on the first
  // trainee booking. Subsequent trainee bookings find no FORMER STUDENT opp
  // (already gone) and just create their own opp.
  console.log('[handleBtmBooking] BRANCH_B new trainee — scanning for FORMER STUDENT opp', {
    traineeKey,
    candidateOppIds: btmOpps.map((o) => o.id),
  });
  for (const opp of btmOpps) {
    try {
      if (await isAtStage(opp, 'BACK_TO_MATS', 'FORMER STUDENT')) {
        console.log('[handleBtmBooking] deleting FORMER STUDENT opp', { oppId: opp.id });
        await deleteOpportunity(opp.id);
        break;
      }
    } catch (err) {
      console.warn('[handleBtmBooking] FORMER STUDENT delete failed (non-fatal)', err);
    }
  }

  try {
    const oppCfs = await cfPayload('opportunity', {
      trainee_key: traineeKey,
      trainee_first_name: input.trainee.firstName,
      trainee_dob: input.trainee.dob ?? '',
      program: input.program,
      last_appointment_id: input.appointmentId,
      last_appointment_start_iso: input.slotStartISO,
      appointment_date: toAcademyLocalDate(input.slotStartISO),
      appointment_history: input.appointmentId,
    });
    const created = await createOpp({
      pipelineKey: 'BACK_TO_MATS',
      stageName: 'RE ENROLLMENT CLASS BOOKED',
      contactId: input.contactId,
      name: oppName,
      source: 'back-to-the-mats',
      customFields: oppCfs,
    });
    console.log('[handleBtmBooking] BRANCH_B created opp', {
      newOppId: created.id,
      requestedName: oppName,
      responseName: created.name,
      traineeKey,
    });
    await exitNurtureWorkflows(input.contactId, 'btm');
    return { contactId: input.contactId, opportunityId: created.id, isRebook: false, stage: 'RE ENROLLMENT CLASS BOOKED' };
  } catch (err) {
    console.error('[handleBtmBooking] BRANCH_B createOpp failed',
      err instanceof GhlError ? { status: err.status, body: err.bodyText, path: err.path, traineeKey, oppName } : { err, traineeKey, oppName });
    return { contactId: input.contactId, opportunityId: '', isRebook: false, stage: 'BTM_CREATE_FAILED' };
  }
}

// ─── Trial booking path ────────────────────────────────────────────────────
/**
 * Trial-flow booking handler (/kickstart). Touches LEAD_ACQ + TRIAL_CONV.
 * This is the original handleBooking behavior, extracted into its own
 * function so the BTM path can be entirely independent.
 */
async function handleTrialBooking(
  input: HandleBookingInput,
  traineeKey: string,
): Promise<HandleBookingResult> {
  const oppName = input.trainee.isSelf
    ? `${input.parent.firstName} ${input.parent.lastName}`
    : `${input.trainee.firstName} ${input.parent.lastName}`;

  // Pre-POST rebook detection: existing TRIAL_CONV opp matching this trainee?
  const existingOpps = await findOpps({
    contactId: input.contactId,
    pipelineKey: 'TRIAL_CONV',
    status: 'open',
    limit: 20,
  });
  const existingOpp = await findByTraineeKey(existingOpps, traineeKey);

  // ─── Branch A: rebook (existing Trial Conv opp found) ────────────────
  if (existingOpp) {
    const oppCfs = await cfPayload('opportunity', {
      trainee_key: traineeKey,
      trainee_first_name: input.trainee.firstName,
      program: input.program,
      last_appointment_id: input.appointmentId,
      last_appointment_start_iso: input.slotStartISO,
      appointment_date: toAcademyLocalDate(input.slotStartISO),
    });
    const updated = await moveStage({
      oppId: existingOpp.id,
      pipelineKey: 'TRIAL_CONV',
      stageName: 'INTRO BOOKED',
      customFields: oppCfs,
    });
    const traineeLabel = formatTraineeLabel(input.trainee.firstName, input.trainee.age, input.trainee.isSelf);
    await addContactNote(
      input.contactId,
      `Re-booked: ${traineeLabel} — ${input.programName}, ${formatTrialTime(input.slotStartISO)}`,
    );
    await exitNurtureWorkflows(input.contactId, 'trial');
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
    appointment_date: toAcademyLocalDate(input.slotStartISO),
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

  // Move Lead Acquisition opp → INTRO BOOKED (WON) and consolidate. Schema
  // contract is "one LEAD_ACQ opp per parent contact" — but races on rapid
  // opt-in resubmits can leave duplicates. Keep one, mark won, delete the
  // rest so the contact disappears cleanly from NEW LEAD / nurture stages.
  // Best-effort: missing opp = walk-in without prior opt-in (recoverable).
  try {
    const leadOpps = await findOpps({
      contactId: input.contactId,
      pipelineKey: 'LEAD_ACQ',
      status: 'open',
      limit: 20,
    });
    const [keeper, ...duplicates] = leadOpps;
    if (keeper) {
      await moveStage({
        oppId: keeper.id,
        pipelineKey: 'LEAD_ACQ',
        stageName: 'INTRO BOOKED (WON)',
      });
      await setOppStatus(keeper.id, 'won');
    }
    for (const dup of duplicates) {
      try {
        await deleteOpportunity(dup.id);
      } catch (err) {
        console.warn('[handleTrialBooking] Lead Acq duplicate delete failed (non-fatal)', { dupId: dup.id, err });
      }
    }
  } catch (err) {
    console.warn('[handleTrialBooking] Lead Acq stage move failed (non-fatal)', err);
  }

  const traineeLabel = formatTraineeLabel(input.trainee.firstName, input.trainee.age, input.trainee.isSelf);
  await addContactNote(
    input.contactId,
    `First trial booked: ${traineeLabel} — ${input.programName}, ${formatTrialTime(input.slotStartISO)}`,
  );
  await exitNurtureWorkflows(input.contactId, 'trial');

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
  // Find existing Credit Monitoring opp matching trainee_key
  const existing = await findOpps({
    contactId: input.contactId,
    pipelineKey: 'CREDIT_MON',
    status: 'open',
    limit: 20,
  });
  const existingCredit = await findByTraineeKey(existing, input.traineeKey);

  // Read credits from existing opp (if any). New opp inits to TRIAL_CREDITS_DEFAULT.
  let credits = existingCredit ? Number((await getOppCfValueByKey(existingCredit, 'credits_remaining')) ?? 0) : 0;
  if (!Number.isFinite(credits) || credits <= 0) {
    const defaultCredits = Number(readEnv('TRIAL_CREDITS_DEFAULT') ?? '3');
    credits = Number.isFinite(defaultCredits) ? defaultCredits : 3;
  }

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
    credits_remaining: credits,
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
      `Trial attended by ${input.traineeFirstName} on ${formatTrialTime(input.lastTrialDateISO)} — ${credits} credit${credits === 1 ? '' : 's'} remaining.`,
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
    `Trial pass activated for ${input.traineeFirstName} — ${credits} class${credits === 1 ? '' : 'es'} available. First class attended ${formatTrialTime(input.lastTrialDateISO)}.`,
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
  // Read credit state directly from the opportunity (per-trainee, not per-contact).
  const opps = await findOpps({
    contactId: input.contactId,
    pipelineKey: 'CREDIT_MON',
    status: 'open',
    limit: 20,
  });
  const opp = opps.find((o) => o.id === input.oppId);
  if (!opp) {
    // Opp closed or not found — silent no-op (webhook may have been delayed).
    return {
      contactId: input.contactId,
      oppId: input.oppId,
      creditsRemaining: 0,
      endStage: 'ATTENDED APPOINTMENT',
      wasDecremented: false,
    };
  }

  const lastDecrement = await getOppCfValueByKey<string>(opp, 'last_decrement_trial_date');
  const before = Number((await getOppCfValueByKey<number | string>(opp, 'credits_remaining')) ?? 0) || 0;

  // Idempotency guard — same trial date already decremented on this opp? No-op.
  if (lastDecrement && lastDecrement === input.trialDateISO) {
    return {
      contactId: input.contactId,
      oppId: input.oppId,
      creditsRemaining: before,
      endStage: 'ATTENDED APPOINTMENT',
      wasDecremented: false,
    };
  }

  const after = Math.max(0, before - 1);
  const nextStage = after > 0 ? 'CREDIT ACTIVE' : 'CREDITS EXHAUSTED';

  // Persist new credit count + idempotency marker on the opp itself.
  const oppCfs = await cfPayload('opportunity', {
    credits_remaining: after,
    last_decrement_trial_date: input.trialDateISO,
    last_attendance_iso: input.trialDateISO,
  });
  await moveStage({
    oppId: input.oppId,
    pipelineKey: 'CREDIT_MON',
    stageName: nextStage,
    customFields: oppCfs,
  });

  // Try to use trainee's first name from the opp; fallback to trainee_key.
  const traineeName =
    (await getOppCfValueByKey<string>(opp, 'trainee_first_name')) ||
    input.traineeKey ||
    'student';
  const stageLabel = nextStage === 'CREDITS EXHAUSTED' ? 'pass exhausted' : `${after} class${after === 1 ? '' : 'es'} remaining`;
  await addContactNote(
    input.contactId,
    `Class attended by ${traineeName} on ${formatTrialTime(input.trialDateISO)} — ${stageLabel}.`,
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
  let matchingOpp: typeof opps[number] | undefined;
  for (const o of opps) {
    const apptId = await getOppCfValueByKey<string>(o, 'last_appointment_id');
    if (apptId === input.appointmentId) { matchingOpp = o; break; }
  }

  if (matchingOpp) {
    await setOppStatus(matchingOpp.id, 'abandoned');
  }

  const who = input.source === 'customer' ? 'customer' : 'staff';
  await addContactNote(
    input.contactId,
    `Appointment cancelled by ${who}${input.reason ? ` — reason: ${input.reason}` : '.'}`,
  );

  // Optional follow-up workflow
  const cancelWf = readEnv('WORKFLOW_ID_CANCEL_FOLLOWUP');
  if (cancelWf) await addContactToWorkflow(input.contactId, cancelWf);

  return { contactId: input.contactId, trialConvOppId: matchingOpp?.id };
}

// ─── handleAppointmentStatusChange ─────────────────────────────────────────
// Fired when an admin changes an appointment's status in the GHL calendar
// (Appointment List View). Finds the opportunity that owns the appointment —
// across all three appointment-bearing pipelines (TRIAL_CONV, CREDIT_MON,
// BACK_TO_MATS) — and applies the mapped, stage-guarded transition declared
// in APPOINTMENT_STATUS_TRANSITIONS.
//
// Downstream effects (credit decrement, rebooking campaigns) are NOT run
// here: a stage move fires the existing GHL backflow webhooks, which dispatch
// the STAGE_TRANSITIONS actions. This handler only does the move/abandon.

/** Actionable GHL appointment statuses. `confirmed`/`new` are filtered upstream. */
export type AppointmentStatus = 'showed' | 'noshow' | 'cancelled' | 'invalid';

const APPT_STATUS_LABEL: Record<AppointmentStatus, string> = {
  showed: 'Showed',
  noshow: 'No Show',
  cancelled: 'Cancelled',
  invalid: 'Invalid',
};

export interface HandleAppointmentStatusInput {
  contactId: string;
  appointmentId: string;
  /** Normalized status — one of the actionable values. */
  status: AppointmentStatus;
  /** Optional cancellation reason, surfaced in the audit note. */
  reason?: string;
}

export interface HandleAppointmentStatusResult {
  contactId: string;
  appointmentId: string;
  /** Owning opp, when one was found. */
  oppId?: string;
  pipelineKey?: PipelineKey;
  /**
   * What happened:
   *   - 'moved'     — opp moved to a new stage
   *   - 'abandoned' — opp status set to abandoned
   *   - 'noop'      — the mapping says do nothing for this status/pipeline
   *   - 'guarded'   — opp found but not in an awaiting-classification stage
   *   - 'unmatched' — no open opp owns this appointment
   */
  outcome: 'moved' | 'abandoned' | 'noop' | 'guarded' | 'unmatched';
  /** Stage the opp landed at (only when outcome === 'moved'). */
  stage?: string;
}

export async function handleAppointmentStatusChange(
  input: HandleAppointmentStatusInput,
): Promise<HandleAppointmentStatusResult> {
  const base = { contactId: input.contactId, appointmentId: input.appointmentId };

  // Locate the owning opp. The opp that owns an appointment is the one whose
  // `last_appointment_id` CF matches. Probe each appointment-bearing pipeline
  // independently — a pipeline that isn't provisioned yet (no PIPELINE_ID_*
  // env var) throws on lookup and is simply skipped.
  let found: { opp: OpportunityRecord; rule: ApptStatusTransition } | undefined;

  for (const rule of APPOINTMENT_STATUS_TRANSITIONS) {
    let opps: OpportunityRecord[];
    try {
      opps = await findOpps({
        contactId: input.contactId,
        pipelineKey: rule.pipelineKey,
        status: 'open',
        limit: 20,
      });
    } catch (err) {
      console.warn(
        `[handleAppointmentStatusChange] ${rule.pipelineKey} lookup skipped`,
        String(err).slice(0, 200),
      );
      continue;
    }
    for (const opp of opps) {
      const apptId = await getOppCfValueByKey<string>(opp, 'last_appointment_id');
      if (apptId === input.appointmentId) {
        found = { opp, rule };
        break;
      }
    }
    if (found) break;
  }

  if (!found) {
    console.warn('[handleAppointmentStatusChange] no open opp owns this appointment', base);
    return { ...base, outcome: 'unmatched' };
  }

  const { opp, rule } = found;
  const ctx = { ...base, oppId: opp.id, pipelineKey: rule.pipelineKey };

  // Pick the outcome for this status (cancelled + invalid share onCancelled).
  const outcome: ApptOutcome =
    input.status === 'showed'
      ? rule.onShowed
      : input.status === 'noshow'
        ? rule.onNoShow
        : rule.onCancelled;

  if (outcome.action === 'none') {
    return { ...ctx, outcome: 'noop' };
  }

  // Stage guard — only act while the opp is still awaiting classification.
  const guardIds = await Promise.all(
    rule.whenInStages.map((s) => getStageId(rule.pipelineKey, s)),
  );
  if (!opp.pipelineStageId || !guardIds.includes(opp.pipelineStageId)) {
    console.log('[handleAppointmentStatusChange] opp not in an awaiting stage — skipping', ctx);
    return { ...ctx, outcome: 'guarded' };
  }

  const label = APPT_STATUS_LABEL[input.status];
  const reasonSuffix = input.reason ? ` Reason: ${input.reason}` : '';

  if (outcome.action === 'abandon') {
    await setOppStatus(opp.id, 'abandoned');
    await addContactNote(
      input.contactId,
      `Appointment marked ${label} in GHL — opportunity closed (abandoned).${reasonSuffix}`,
    );
    // Preserve the legacy admin-cancellation followup behavior.
    const cancelWf = readEnv('WORKFLOW_ID_CANCEL_FOLLOWUP');
    if (cancelWf) {
      try {
        await addContactToWorkflow(input.contactId, cancelWf);
      } catch (err) {
        console.warn('[handleAppointmentStatusChange] cancel-followup enroll failed (non-fatal)', err);
      }
    }
    return { ...ctx, outcome: 'abandoned' };
  }

  // outcome.action === 'move'
  await moveStage({ oppId: opp.id, pipelineKey: rule.pipelineKey, stageName: outcome.stage });
  await addContactNote(
    input.contactId,
    `Appointment marked ${label} in GHL — opportunity moved to ${outcome.stage}.${reasonSuffix}`,
  );
  return { ...ctx, outcome: 'moved', stage: outcome.stage };
}
