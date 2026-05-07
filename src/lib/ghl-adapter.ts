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
import { findOpps, createOpp, updateOppFields } from './ghl-opportunities';
import { cfPayload } from './ghl-custom-fields';
import { deriveTraineeKey } from './trainee-key';
import { readEnv } from './ghl';

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
