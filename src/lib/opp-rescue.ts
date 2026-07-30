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
/**
 * Raised 14 → 21 on 2026-07-31 to track `credit_active_to_reactivation_days`, which was
 * itself raised to match the Another Trial Booking Campaign as actually built (retimed
 * live 57d → 21d). Leaving this at 14 made the credits rescue report opps as overdue that
 * the live workflow had not yet released, overstating how many customers were eligible for
 * a drip that MESSAGES THEM. Keep this in lockstep with the custom value in
 * config/ghl-schema.ts — the two drifting apart is exactly how the wrong people get texted.
 */
const CREDIT_ACTIVE_TO_REACTIVATION_DAYS = 21;

export interface RescueOpp {
  id: string;
  contactId: string;
  stageName: string;
  createdAt: string;
  updatedAt: string;
  /**
   * GHL opportunity status ('open' | 'won' | 'lost' | 'abandoned' | ...). The
   * feeding searches use `status=all` so the AUDIT counts are complete, but only
   * `open` opps may be MUTATED — moving a won/lost/abandoned opp back into an
   * active stage would force it open again and (for CREDIT_MON) fire a live
   * reactivation drip at someone who already enrolled or explicitly went cold.
   */
  status: string;
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
  /**
   * Status to write alongside the stage move, mirroring STAGE_TRANSITIONS in
   * config/ghl-schema.ts (LEAD_ACQ → 'LOST / COLD' is a `set_status: lost`
   * stage). The GHL-side config drifted — which is why this rescue exists — so
   * we cannot rely on a workflow to correct the status after the move.
   */
  targetStatus: 'open' | 'lost';
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
    // Only open opps may be mutated — see RescueOpp.status.
    if (o.status !== 'open') continue;
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
      // STAGE_TRANSITIONS: LEAD_ACQ / LOST / COLD → set_status lost.
      targetStatus: 'lost',
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
    // Only open opps may be mutated — see RescueOpp.status. A won/lost opp in
    // CREDIT ACTIVE must never be dragged back open and sent a live drip.
    if (o.status !== 'open') continue;
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
      // REACTIVATION is an active stage — the opp stays open.
      targetStatus: 'open',
    });
  }
  return moves.sort((a, b) => b.daysOverdue - a.daysOverdue);
}
