/**
 * Selection logic for rescuing opportunities stranded by the Jul 2026 stage-timer
 * failure. Pure — no network I/O — so the "who moves where" decision is testable
 * before anything mutates a live account. Applied by scripts/rescue-stranded-opps.ts.
 *
 * Timer values mirror the CUSTOM_VALUES defaults in config/ghl-schema.ts.
 */

const DAY_MS = 86_400_000;

/** NEW LEAD (24h) + TRIAL NURTURE (7d) + NURTURE CAMPAIGN (14d) = 22d; use 21 as the practical deadline. */
const LEAD_ACQ_TERMINAL_DAYS = 21;
const NURTURE_CAMPAIGN_TO_LOST_DAYS = 14;
const CREDIT_ACTIVE_TO_REACTIVATION_DAYS = 14;

export interface RescueOpp {
  id: string;
  contactId: string;
  stageName: string;
  createdAt: string;
  updatedAt: string;
  /** True when this contact also has a Trial Conversion opp — i.e. they booked at least once. */
  hasTrialConvOpp: boolean;
}

export interface RescueMove {
  oppId: string;
  contactId: string;
  fromStage: string;
  toStage: string;
  pipelineKey: 'LEAD_ACQ' | 'CREDIT_MON';
  daysOverdue: number;
  /** True when entering toStage fires a workflow that messages the customer. */
  sendsMessages: boolean;
}

const daysBetween = (fromIso: string, now: number): number =>
  Math.round((now - Date.parse(fromIso)) / DAY_MS);

/**
 * Never-booked Lead Acquisition opps that blew past their terminal deadline.
 * Re-nurtured opps (contact has a Trial Conv opp) are excluded — their presence in
 * NURTURE CAMPAIGN is the intended result of the Trial Conv LOST/COLD cross-move,
 * and their clock legitimately restarted.
 */
export function selectOverdueLeadAcqOpps(opps: RescueOpp[], now: number): RescueMove[] {
  const moves: RescueMove[] = [];
  for (const o of opps) {
    if (o.hasTrialConvOpp) continue;

    let daysOverdue: number;
    if (o.stageName === 'TRIAL NURTURE') {
      daysOverdue = daysBetween(o.createdAt, now) - LEAD_ACQ_TERMINAL_DAYS;
    } else if (o.stageName === 'NURTURE CAMPAIGN') {
      daysOverdue = daysBetween(o.updatedAt, now) - NURTURE_CAMPAIGN_TO_LOST_DAYS;
    } else {
      continue;
    }
    if (daysOverdue <= 0) continue;

    moves.push({
      oppId: o.id,
      contactId: o.contactId,
      fromStage: o.stageName,
      toStage: 'LOST / COLD',
      pipelineKey: 'LEAD_ACQ',
      daysOverdue,
      sendsMessages: false,
    });
  }
  return moves.sort((a, b) => b.daysOverdue - a.daysOverdue);
}

/**
 * Trial-pass holders idle past the CREDIT ACTIVE timer. Moving them to REACTIVATION
 * fires the published Trial Active Reactivation Campaign — this MESSAGES REAL CUSTOMERS.
 */
export function selectIdleCreditOpps(opps: RescueOpp[], now: number): RescueMove[] {
  const moves: RescueMove[] = [];
  for (const o of opps) {
    if (o.stageName !== 'CREDIT ACTIVE') continue;
    const daysOverdue = daysBetween(o.updatedAt, now) - CREDIT_ACTIVE_TO_REACTIVATION_DAYS;
    if (daysOverdue <= 0) continue;

    moves.push({
      oppId: o.id,
      contactId: o.contactId,
      fromStage: o.stageName,
      toStage: 'REACTIVATION',
      pipelineKey: 'CREDIT_MON',
      daysOverdue,
      sendsMessages: true,
    });
  }
  return moves.sort((a, b) => b.daysOverdue - a.daysOverdue);
}
