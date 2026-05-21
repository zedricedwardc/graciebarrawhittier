import { describe, it, expect } from 'vitest';
import { resolveTraineeCards, CONTACT_SCOPED_TRAINEE_KEY, type OppFacts } from './rebook-cards';

function fact(over: Partial<OppFacts>): OppFacts {
  return {
    pipeline: 'CREDIT_MON',
    status: 'open',
    traineeKey: 'tk-1',
    traineeName: 'Mia',
    program: 'lc2',
    creditsRemaining: 0,
    lastAttendanceISO: null,
    lastAppointmentStartISO: null,
    ...over,
  };
}

describe('resolveTraineeCards', () => {
  it('renders an active card for an open credit opp with credits', () => {
    const [card] = resolveTraineeCards([fact({ creditsRemaining: 3 })]);
    expect(card!.status).toBe('active');
    expect(card!.creditsRemaining).toBe(3);
  });

  it('renders an exhausted card for an open credit opp with zero credits', () => {
    const [card] = resolveTraineeCards([fact({ creditsRemaining: 0 })]);
    expect(card!.status).toBe('exhausted');
  });

  it('renders a pending card for an open trial-conv opp with no credit opp', () => {
    const [card] = resolveTraineeCards([
      fact({ pipeline: 'TRIAL_CONV', status: 'open', lastAppointmentStartISO: '2026-05-24T16:00:00-07:00' }),
    ]);
    expect(card!.status).toBe('pending');
    expect(card!.nextClassISO).toBe('2026-05-24T16:00:00-07:00');
  });

  it('renders an enrolled card for a won trial-conv opp', () => {
    const [card] = resolveTraineeCards([fact({ pipeline: 'TRIAL_CONV', status: 'won' })]);
    expect(card!.status).toBe('enrolled');
  });

  it('populates nextClassISO for an active card from the credit opp', () => {
    const [card] = resolveTraineeCards([
      fact({ creditsRemaining: 2, lastAppointmentStartISO: '2026-06-01T18:00:00-07:00' }),
    ]);
    expect(card!.status).toBe('active');
    expect(card!.nextClassISO).toBe('2026-06-01T18:00:00-07:00');
  });

  it('populates nextClassISO for an enrolled card from the won trial-conv opp', () => {
    const [card] = resolveTraineeCards([
      fact({ pipeline: 'TRIAL_CONV', status: 'won', lastAppointmentStartISO: '2026-06-05T17:00:00-07:00' }),
    ]);
    expect(card!.status).toBe('enrolled');
    expect(card!.nextClassISO).toBe('2026-06-05T17:00:00-07:00');
  });

  it('leaves nextClassISO null when the opp has no last appointment', () => {
    const [card] = resolveTraineeCards([fact({ creditsRemaining: 1 })]);
    expect(card!.nextClassISO).toBeNull();
  });

  it('credit opp beats a pending trial-conv opp for the same trainee_key', () => {
    const cards = resolveTraineeCards([
      fact({ pipeline: 'CREDIT_MON', status: 'open', creditsRemaining: 2 }),
      fact({ pipeline: 'TRIAL_CONV', status: 'open' }),
    ]);
    expect(cards).toHaveLength(1);
    expect(cards[0]!.status).toBe('active');
  });

  it('a won trial-conv opp beats an open credit opp for the same trainee_key', () => {
    const cards = resolveTraineeCards([
      fact({ pipeline: 'CREDIT_MON', status: 'open', creditsRemaining: 2 }),
      fact({ pipeline: 'TRIAL_CONV', status: 'won' }),
    ]);
    expect(cards).toHaveLength(1);
    expect(cards[0]!.status).toBe('enrolled');
  });

  it('produces no card for a trainee with only lost/abandoned opps', () => {
    const cards = resolveTraineeCards([
      fact({ pipeline: 'TRIAL_CONV', status: 'lost' }),
      fact({ pipeline: 'TRIAL_CONV', status: 'abandoned' }),
    ]);
    expect(cards).toHaveLength(0);
  });

  it('produces one card per distinct trainee_key', () => {
    const cards = resolveTraineeCards([
      fact({ traineeKey: 'tk-1', creditsRemaining: 3 }),
      fact({ traineeKey: 'tk-2', pipeline: 'TRIAL_CONV', status: 'open' }),
    ]);
    expect(cards).toHaveLength(2);
    expect(new Set(cards.map((c) => c.status))).toEqual(new Set(['active', 'pending']));
  });

  it('exports the sentinel value for contact-scoped tokens', () => {
    expect(CONTACT_SCOPED_TRAINEE_KEY).toBe('__contact__');
  });
});
