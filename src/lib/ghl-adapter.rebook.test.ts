import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { OpportunityRecord } from './ghl';

// Stub the GHL write/lookup primitives the trial rebook branch reaches. readEnv
// stays real so exitNurtureWorkflows resolves workflow IDs from process.env.
vi.mock('./ghl', async () => {
  const actual = await vi.importActual<typeof import('./ghl')>('./ghl');
  return {
    ...actual,
    getContact: vi.fn(async () => ({ id: 'contact_1', customFields: [] })),
    updateContact: vi.fn(async () => {}),
    addContactNote: vi.fn(async () => {}),
    addContactToWorkflow: vi.fn(async () => {}),
    removeContactFromWorkflow: vi.fn(async () => {}),
    cancelAppointment: vi.fn(async () => {}),
  };
});
vi.mock('./ghl-opportunities', async () => {
  const actual = await vi.importActual<typeof import('./ghl-opportunities')>('./ghl-opportunities');
  return {
    ...actual,
    findOpps: vi.fn(),
    findByTraineeKey: vi.fn(),
    getOppCfValueByKey: vi.fn(),
    moveStage: vi.fn(async ({ oppId }: { oppId: string }) => ({ id: oppId })),
  };
});
vi.mock('./ghl-pipelines', async () => {
  const actual = await vi.importActual<typeof import('./ghl-pipelines')>('./ghl-pipelines');
  return {
    ...actual,
    getStageId: vi.fn(async (_pk: string, stage: string) => `stage-${stage}`),
  };
});
// cfPayload reaches the GHL custom-field cache; stub it to a passthrough so the
// rebook branch never touches the network when building opp custom fields.
vi.mock('./ghl-custom-fields', async () => {
  const actual = await vi.importActual<typeof import('./ghl-custom-fields')>('./ghl-custom-fields');
  return {
    ...actual,
    cfPayload: vi.fn(async () => []),
  };
});

import { handleBooking, type HandleBookingInput } from './ghl-adapter';
import { cancelAppointment } from './ghl';
import { findOpps, findByTraineeKey, getOppCfValueByKey, moveStage } from './ghl-opportunities';

const cancelApptMock = vi.mocked(cancelAppointment);
const findOppsMock = vi.mocked(findOpps);
const findByTraineeKeyMock = vi.mocked(findByTraineeKey);
const getCfMock = vi.mocked(getOppCfValueByKey);
const moveStageMock = vi.mocked(moveStage);

// The trial-funnel workflows exitNurtureWorkflows('trial') pulls from.
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

const NEW_APPT_ID = 'appt-new';

function makeInput(overrides: Partial<HandleBookingInput> = {}): HandleBookingInput {
  return {
    contactId: 'contact_1',
    appointmentId: NEW_APPT_ID,
    parent: { firstName: 'Pat', lastName: 'Doe', email: 'pat@example.com', phone: '+15551112222' },
    trainee: { firstName: 'Pat', age: 30, isSelf: true },
    program: 'adults',
    programName: 'Adults',
    slotStartISO: '2026-07-01T17:00:00.000Z',
    slotEndISO: '2026-07-01T18:00:00.000Z',
    flow: 'trial',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(process.env, TRIAL_WFS);
  // Rebook branch always finds an existing TRIAL_CONV opp for this trainee.
  findByTraineeKeyMock.mockResolvedValue(makeOpp());
  findOppsMock.mockImplementation(async ({ pipelineKey }) =>
    pipelineKey === 'TRIAL_CONV' ? [makeOpp()] : [],
  );
  moveStageMock.mockResolvedValue(makeOpp());
});
afterEach(() => {
  for (const k of Object.keys(TRIAL_WFS)) delete process.env[k];
});

describe('handleTrialBooking — rebook branch appointment cancel', () => {
  it('cancels the OLD appointment once when stored last_appointment_id differs from the new one', async () => {
    getCfMock.mockResolvedValue('appt-old' as never);

    const res = await handleBooking(makeInput());

    expect(res.isRebook).toBe(true);
    expect(cancelApptMock).toHaveBeenCalledTimes(1);
    expect(cancelApptMock).toHaveBeenCalledWith('appt-old');
    // Opp is reused, never re-created — moveStage carries it.
    expect(moveStageMock).toHaveBeenCalledTimes(1);
  });

  it('does NOT cancel when stored last_appointment_id equals the new appointmentId', async () => {
    getCfMock.mockResolvedValue(NEW_APPT_ID as never);

    const res = await handleBooking(makeInput());

    expect(res.isRebook).toBe(true);
    expect(cancelApptMock).not.toHaveBeenCalled();
  });

  it('does NOT cancel when stored last_appointment_id is missing/empty', async () => {
    getCfMock.mockResolvedValue(undefined as never);

    const res = await handleBooking(makeInput());

    expect(res.isRebook).toBe(true);
    expect(cancelApptMock).not.toHaveBeenCalled();
  });
});
