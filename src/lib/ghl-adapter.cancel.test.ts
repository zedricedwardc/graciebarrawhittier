import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { OpportunityRecord } from './ghl';

// Stub only the GHL write/lookup primitives the cancel handlers reach. readEnv
// stays real so exitNurtureWorkflows resolves workflow IDs from process.env.
vi.mock('./ghl', async () => {
  const actual = await vi.importActual<typeof import('./ghl')>('./ghl');
  return {
    ...actual,
    addContactNote: vi.fn(async () => {}),
    addContactToWorkflow: vi.fn(async () => {}),
    removeContactFromWorkflow: vi.fn(async () => {}),
  };
});
vi.mock('./ghl-opportunities', async () => {
  const actual = await vi.importActual<typeof import('./ghl-opportunities')>('./ghl-opportunities');
  return {
    ...actual,
    findOpps: vi.fn(),
    getOppCfValueByKey: vi.fn(),
    setOppStatus: vi.fn(async () => {}),
    moveStage: vi.fn(async () => {}),
  };
});
vi.mock('./ghl-pipelines', async () => {
  const actual = await vi.importActual<typeof import('./ghl-pipelines')>('./ghl-pipelines');
  return {
    ...actual,
    getStageId: vi.fn(async (_pk: string, stage: string) => `stage-${stage}`),
  };
});

import { handleCancellation, handleAppointmentStatusChange } from './ghl-adapter';
import { addContactToWorkflow, removeContactFromWorkflow } from './ghl';
import { findOpps, getOppCfValueByKey, setOppStatus } from './ghl-opportunities';

const findOppsMock = vi.mocked(findOpps);
const getCfMock = vi.mocked(getOppCfValueByKey);
const setOppStatusMock = vi.mocked(setOppStatus);
const removeWfMock = vi.mocked(removeContactFromWorkflow);
const addWfMock = vi.mocked(addContactToWorkflow);

// The four trial-funnel workflows exitNurtureWorkflows('trial') pulls from.
const TRIAL_WFS = {
  WORKFLOW_ID_TRIAL_NURTURE: 'wf-trial-nurture',
  WORKFLOW_ID_NURTURE_CAMPAIGN: 'wf-nurture-campaign',
  WORKFLOW_ID_REBOOKING_CAMPAIGN: 'wf-rebooking',
  WORKFLOW_ID_INACTIVE_REACTIVATION: 'wf-inactive',
};

function makeOpp(overrides: Partial<OpportunityRecord> = {}): OpportunityRecord {
  return {
    id: 'opp_1',
    pipelineStageId: 'stage-INTRO BOOKED',
    customFields: [],
    ...overrides,
  } as OpportunityRecord;
}

const removedWfIds = () => removeWfMock.mock.calls.map((c) => c[1]).sort();

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(process.env, TRIAL_WFS);
  // Present in env but must no longer be used by the cancel paths.
  process.env.WORKFLOW_ID_CANCEL_FOLLOWUP = 'wf-cancel-followup';
});
afterEach(() => {
  for (const k of Object.keys(TRIAL_WFS)) delete process.env[k];
  delete process.env.WORKFLOW_ID_CANCEL_FOLLOWUP;
});

describe('handleCancellation', () => {
  it('abandons the trial opp and removes the contact from trial nurture workflows', async () => {
    findOppsMock.mockResolvedValue([makeOpp()]);
    getCfMock.mockResolvedValue('appt-1' as never);

    await handleCancellation({ contactId: 'contact_1', appointmentId: 'appt-1', source: 'customer' });

    expect(setOppStatusMock).toHaveBeenCalledWith('opp_1', 'abandoned');
    expect(removedWfIds()).toEqual(Object.values(TRIAL_WFS).sort());
    // The cancel-followup enroll has been removed entirely.
    expect(addWfMock).not.toHaveBeenCalled();
  });
});

describe('handleAppointmentStatusChange — cancelled/invalid (abandon path)', () => {
  beforeEach(() => {
    findOppsMock.mockImplementation(async ({ pipelineKey }) =>
      pipelineKey === 'TRIAL_CONV' ? [makeOpp()] : [],
    );
    getCfMock.mockResolvedValue('appt-1' as never);
  });

  it('cancelled: abandons the opp, exits trial workflows, never enrolls cancel-followup', async () => {
    const res = await handleAppointmentStatusChange({
      contactId: 'contact_1',
      appointmentId: 'appt-1',
      status: 'cancelled',
    });

    expect(res.outcome).toBe('abandoned');
    expect(setOppStatusMock).toHaveBeenCalledWith('opp_1', 'abandoned');
    expect(removedWfIds()).toEqual(Object.values(TRIAL_WFS).sort());
    expect(addWfMock).not.toHaveBeenCalled();
  });

  it('invalid is treated identically to cancelled', async () => {
    const res = await handleAppointmentStatusChange({
      contactId: 'contact_1',
      appointmentId: 'appt-1',
      status: 'invalid',
    });

    expect(res.outcome).toBe('abandoned');
    expect(removeWfMock).toHaveBeenCalled();
    expect(addWfMock).not.toHaveBeenCalled();
  });
});
