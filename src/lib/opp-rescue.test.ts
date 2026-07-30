import { describe, it, expect } from 'vitest';
import { selectOverdueLeadAcqOpps, selectIdleCreditOpps, type RescueOpp } from './opp-rescue';

const NOW = Date.parse('2026-07-30T00:00:00Z');
const daysAgo = (n: number) => new Date(NOW - n * 86400000).toISOString();

function opp(over: Partial<RescueOpp>): RescueOpp {
  return {
    id: 'o1', contactId: 'c1', stageName: 'TRIAL NURTURE',
    createdAt: daysAgo(30), updatedAt: daysAgo(30), status: 'open', hasTrialConvOpp: false, ...over,
  };
}

describe('selectOverdueLeadAcqOpps', () => {
  it('moves a never-booked TRIAL NURTURE opp past day 21 to LOST / COLD', () => {
    const moves = selectOverdueLeadAcqOpps([opp({ createdAt: daysAgo(75), updatedAt: daysAgo(74) })], NOW);
    expect(moves).toHaveLength(1);
    expect(moves[0]!).toMatchObject({
      toStage: 'LOST / COLD', pipelineKey: 'LEAD_ACQ', sendsMessages: false, targetStatus: 'lost',
    });
    expect(moves[0]!.daysOverdue).toBe(54); // 75 days old - 21 day spec deadline
  });

  it('moves a never-booked NURTURE CAMPAIGN opp past its 14d timer to LOST / COLD', () => {
    const moves = selectOverdueLeadAcqOpps(
      [opp({ stageName: 'NURTURE CAMPAIGN', createdAt: daysAgo(60), updatedAt: daysAgo(40) })], NOW);
    expect(moves).toHaveLength(1);
    expect(moves[0]!.toStage).toBe('LOST / COLD');
    // STAGE_TRANSITIONS declares LEAD_ACQ / LOST / COLD as set_status:lost.
    expect(moves[0]!.targetStatus).toBe('lost');
    expect(moves[0]!.daysOverdue).toBe(26); // 40 days in stage - 14 day timer
  });

  it('leaves an opp that is still within its timer alone', () => {
    const moves = selectOverdueLeadAcqOpps(
      [opp({ stageName: 'NURTURE CAMPAIGN', createdAt: daysAgo(20), updatedAt: daysAgo(5) })], NOW);
    expect(moves).toEqual([]);
  });

  it('skips opps that were re-nurtured from Trial Conversion', () => {
    const moves = selectOverdueLeadAcqOpps(
      [opp({ stageName: 'NURTURE CAMPAIGN', updatedAt: daysAgo(40), hasTrialConvOpp: true })], NOW);
    expect(moves).toEqual([]);
  });

  it('skips a re-nurtured opp on the TRIAL NURTURE branch too', () => {
    const moves = selectOverdueLeadAcqOpps(
      [opp({ stageName: 'TRIAL NURTURE', createdAt: daysAgo(75), updatedAt: daysAgo(74), hasTrialConvOpp: true })],
      NOW,
    );
    expect(moves).toEqual([]);
  });

  it('ignores stages with no auto-move rule', () => {
    const moves = selectOverdueLeadAcqOpps([opp({ stageName: 'INTRO BOOKED (WON)', updatedAt: daysAgo(90) })], NOW);
    expect(moves).toEqual([]);
  });

  it('excludes a non-open opp in an otherwise-eligible stage', () => {
    // status=all feeds these selectors so the audit counts are complete; a
    // won/lost/abandoned opp must never reach the mutating path.
    for (const status of ['won', 'lost', 'abandoned', 'unknown']) {
      const moves = selectOverdueLeadAcqOpps(
        [opp({ stageName: 'NURTURE CAMPAIGN', createdAt: daysAgo(60), updatedAt: daysAgo(40), status })], NOW);
      expect(moves, `status=${status} must be excluded`).toEqual([]);
    }
  });
});

describe('selectIdleCreditOpps', () => {
  it('moves a CREDIT ACTIVE opp past its 21d timer to REACTIVATION and flags it as messaging', () => {
    const moves = selectIdleCreditOpps([opp({ stageName: 'CREDIT ACTIVE', updatedAt: daysAgo(45) })], NOW);
    expect(moves).toHaveLength(1);
    expect(moves[0]!).toMatchObject({
      toStage: 'REACTIVATION', pipelineKey: 'CREDIT_MON', sendsMessages: true, targetStatus: 'open',
    });
    expect(moves[0]!.daysOverdue).toBe(24);
  });

  it('leaves a CREDIT ACTIVE opp within its timer alone', () => {
    expect(selectIdleCreditOpps([opp({ stageName: 'CREDIT ACTIVE', updatedAt: daysAgo(10) })], NOW)).toEqual([]);
  });

  // Regression guard for the 2026-07-31 drift: the live Another Trial Booking Campaign
  // releases at 21 days, so a 15-day-idle opp has NOT been released yet. Selecting it
  // would text a customer the workflow deliberately still holds.
  it('does not select an opp idle 15 days, which the live 21d workflow has not released', () => {
    expect(selectIdleCreditOpps([opp({ stageName: 'CREDIT ACTIVE', updatedAt: daysAgo(15) })], NOW)).toEqual([]);
  });

  it('ignores opps already past CREDIT ACTIVE', () => {
    expect(selectIdleCreditOpps([opp({ stageName: 'ANOTHER TRIAL BOOKED', updatedAt: daysAgo(90) })], NOW)).toEqual([]);
  });

  it('returns most-overdue first so batching rescues the coldest leads last', () => {
    const moves = selectIdleCreditOpps([
      opp({ id: 'a', stageName: 'CREDIT ACTIVE', updatedAt: daysAgo(25) }),
      opp({ id: 'b', stageName: 'CREDIT ACTIVE', updatedAt: daysAgo(50) }),
    ], NOW);
    expect(moves.map((m) => m.oppId)).toEqual(['b', 'a']);
  });

  it('excludes a non-open opp in an otherwise-eligible stage', () => {
    // A won opp in CREDIT ACTIVE would otherwise be forced back open AND sent a
    // live reactivation SMS — to someone who may already have enrolled.
    for (const status of ['won', 'lost', 'abandoned', 'unknown']) {
      const moves = selectIdleCreditOpps(
        [opp({ stageName: 'CREDIT ACTIVE', updatedAt: daysAgo(45), status })], NOW);
      expect(moves, `status=${status} must be excluded`).toEqual([]);
    }
  });
});
