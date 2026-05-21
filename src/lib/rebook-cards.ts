/**
 * Rebook dashboard card resolver.
 *
 * Merges a contact's Trial Credit Monitoring + Trial Conversion opportunities
 * into one card per trainee_key, picking a single status by priority:
 *
 *   enrolled  (won Trial Conversion opp)
 *     > active / exhausted  (open Credit Monitoring opp)
 *       > pending  (open Trial Conversion opp, no Credit opp)
 *
 * `resolveTraineeCards` is pure (no GHL calls) so it is unit-testable.
 * `extractOppFacts` does the async custom-field reads at the endpoint.
 */
import type { OpportunityRecord } from './ghl';
import { getOppCfValueByKey } from './ghl-opportunities';

/**
 * Reserved `traineeKey` for the contact-scoped rebook token. `signRebookToken`
 * rejects an empty traineeKey, so the add-person token uses this sentinel and
 * `/api/rebook-add-person` verifies the token carries exactly this value.
 */
export const CONTACT_SCOPED_TRAINEE_KEY = '__contact__';

export type TraineeStatus = 'enrolled' | 'active' | 'exhausted' | 'pending';

/** Normalized, pipeline-tagged view of one opportunity. */
export interface OppFacts {
  pipeline: 'CREDIT_MON' | 'TRIAL_CONV';
  status: 'open' | 'won' | 'lost' | 'abandoned';
  traineeKey: string;
  traineeName: string;
  program: string;
  creditsRemaining: number;
  lastAttendanceISO: string | null;
  lastAppointmentStartISO: string | null;
}

/** One resolved dashboard card, before the endpoint attaches any token. */
export interface ResolvedTrainee {
  traineeName: string;
  traineeKey: string;
  program: string;
  status: TraineeStatus;
  creditsRemaining: number;
  lastAttendanceISO: string | null;
  /** Next/most-recent appointment ISO datetime, or null if the opp has none. */
  nextClassISO: string | null;
}

/** Read one opportunity into normalized OppFacts (async — reads custom fields). */
export async function extractOppFacts(
  opp: OpportunityRecord,
  pipeline: 'CREDIT_MON' | 'TRIAL_CONV',
): Promise<OppFacts | null> {
  const traineeKey = (await getOppCfValueByKey<string>(opp, 'trainee_key')) ?? '';
  const traineeName = (await getOppCfValueByKey<string>(opp, 'trainee_first_name')) ?? '';
  if (!traineeKey || !traineeName) return null;
  const program = (await getOppCfValueByKey<string>(opp, 'program')) ?? 'adults';
  const creditsRaw = await getOppCfValueByKey<string | number>(opp, 'credits_remaining');
  const creditsRemaining = Number(creditsRaw ?? 0);
  const lastAttendanceISO = (await getOppCfValueByKey<string>(opp, 'last_attendance_iso')) ?? null;
  const lastAppointmentStartISO =
    (await getOppCfValueByKey<string>(opp, 'last_appointment_start_iso')) ?? null;
  const RAW_STATUSES: ReadonlyArray<OppFacts['status']> = ['open', 'won', 'lost', 'abandoned'];
  const status: OppFacts['status'] = RAW_STATUSES.includes(opp.status as OppFacts['status'])
    ? (opp.status as OppFacts['status'])
    : 'open';
  return {
    pipeline,
    status,
    traineeKey,
    traineeName: traineeName.trim(),
    program,
    creditsRemaining: Number.isFinite(creditsRemaining) ? creditsRemaining : 0,
    lastAttendanceISO,
    lastAppointmentStartISO,
  };
}

/**
 * Merge OppFacts into one ResolvedTrainee per trainee_key. Pure.
 *
 *   - enrolled : a won TRIAL_CONV opp exists
 *   - active   : an open CREDIT_MON opp exists, credits > 0
 *   - exhausted: an open CREDIT_MON opp exists, credits <= 0
 *   - pending  : an open TRIAL_CONV opp exists, and no CREDIT_MON opp
 *
 * trainee_keys with only lost/abandoned opps produce no card.
 */
export function resolveTraineeCards(facts: OppFacts[]): ResolvedTrainee[] {
  const byKey = new Map<string, OppFacts[]>();
  for (const f of facts) {
    const list = byKey.get(f.traineeKey) ?? [];
    list.push(f);
    byKey.set(f.traineeKey, list);
  }

  const cards: ResolvedTrainee[] = [];
  for (const [traineeKey, list] of byKey) {
    const enrolled = list.find((f) => f.pipeline === 'TRIAL_CONV' && f.status === 'won');
    const credit = list.find((f) => f.pipeline === 'CREDIT_MON' && f.status === 'open');
    const pendingTrial = list.find((f) => f.pipeline === 'TRIAL_CONV' && f.status === 'open');

    if (enrolled) {
      cards.push({
        traineeName: enrolled.traineeName,
        traineeKey,
        program: enrolled.program,
        status: 'enrolled',
        creditsRemaining: 0,
        lastAttendanceISO: enrolled.lastAttendanceISO,
        nextClassISO: enrolled.lastAppointmentStartISO,
      });
    } else if (credit) {
      cards.push({
        traineeName: credit.traineeName,
        traineeKey,
        program: credit.program,
        status: credit.creditsRemaining > 0 ? 'active' : 'exhausted',
        creditsRemaining: credit.creditsRemaining,
        lastAttendanceISO: credit.lastAttendanceISO,
        nextClassISO: credit.lastAppointmentStartISO,
      });
    } else if (pendingTrial) {
      cards.push({
        traineeName: pendingTrial.traineeName,
        traineeKey,
        program: pendingTrial.program,
        status: 'pending',
        creditsRemaining: 0,
        lastAttendanceISO: pendingTrial.lastAttendanceISO,
        nextClassISO: pendingTrial.lastAppointmentStartISO,
      });
    }
  }
  return cards;
}
