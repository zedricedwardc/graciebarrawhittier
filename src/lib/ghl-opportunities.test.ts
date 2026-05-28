import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { OpportunityRecord } from './ghl';

vi.mock('./ghl', async () => {
  const actual = await vi.importActual<typeof import('./ghl')>('./ghl');
  return {
    ...actual,
    updateOpportunity: vi.fn(),
  };
});
vi.mock('./ghl-custom-fields', async () => {
  const actual = await vi.importActual<typeof import('./ghl-custom-fields')>('./ghl-custom-fields');
  return {
    ...actual,
    getCfId: vi.fn(async (_obj: string, key: string) => `cfid-${key}`),
    cfPayload: vi.fn(async (_obj: string, values: Record<string, unknown>) =>
      Object.entries(values).map(([k, v]) => ({ id: `cfid-${k}`, field_value: v as string | number | boolean | null })),
    ),
  };
});

import { stampEnrollmentDateIfEmpty } from './ghl-opportunities';
import { updateOpportunity } from './ghl';

const updateOppMock = vi.mocked(updateOpportunity);

function makeOpp(overrides: Partial<OpportunityRecord> = {}, cfs: Array<{ id: string; fieldValue?: string }> = []): OpportunityRecord {
  return {
    id: 'opp_123',
    customFields: cfs,
    ...overrides,
  } as OpportunityRecord;
}

beforeEach(() => {
  updateOppMock.mockReset();
  updateOppMock.mockResolvedValue({ id: 'opp_123' } as OpportunityRecord);
});

describe('stampEnrollmentDateIfEmpty', () => {
  it('writes enrollment_date when the opp has no existing value', async () => {
    const opp = makeOpp({}, []);
    await stampEnrollmentDateIfEmpty(opp);
    expect(updateOppMock).toHaveBeenCalledTimes(1);
    const call = updateOppMock.mock.calls[0]!;
    const [oppId, args] = call;
    expect(oppId).toBe('opp_123');
    expect(args.customFields).toEqual([
      { id: 'cfid-enrollment_date', field_value: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) },
    ]);
  });

  it('does not write when enrollment_date is already set', async () => {
    const opp = makeOpp({}, [{ id: 'cfid-enrollment_date', fieldValue: '2026-01-15' }]);
    await stampEnrollmentDateIfEmpty(opp);
    expect(updateOppMock).not.toHaveBeenCalled();
  });

  it('treats whitespace-only existing value as empty and writes', async () => {
    const opp = makeOpp({}, [{ id: 'cfid-enrollment_date', fieldValue: '   ' }]);
    await stampEnrollmentDateIfEmpty(opp);
    expect(updateOppMock).toHaveBeenCalledTimes(1);
  });
});
