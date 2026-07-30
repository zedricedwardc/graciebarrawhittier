import { describe, it, expect, vi, beforeEach } from 'vitest';

// handleOptIn touches several I/O collaborators. Mock the write/read paths on
// each sibling module while keeping everything else (types, pure helpers)
// from the real module, matching the style used in ghl-opportunities.test.ts.
vi.mock('./ghl', async () => {
  const actual = await vi.importActual<typeof import('./ghl')>('./ghl');
  return {
    ...actual,
    upsertContact: vi.fn(async () => 'contact_1'),
    getContact: vi.fn(async () => null),
    updateContact: vi.fn(async () => ({ id: 'contact_1' })),
    addContactTags: vi.fn(async () => undefined),
    addContactToWorkflow: vi.fn(async () => undefined),
    addContactNote: vi.fn(async () => undefined),
  };
});

vi.mock('./ghl-opportunities', async () => {
  const actual = await vi.importActual<typeof import('./ghl-opportunities')>('./ghl-opportunities');
  return {
    ...actual,
    findOpps: vi.fn(async () => []),
    createOpp: vi.fn(async () => ({ id: 'opp_1' })),
    updateOppFields: vi.fn(async () => ({ id: 'opp_1' })),
  };
});

vi.mock('./ghl-custom-fields', async () => {
  const actual = await vi.importActual<typeof import('./ghl-custom-fields')>('./ghl-custom-fields');
  return {
    ...actual,
    cfPayload: vi.fn(async (_obj: string, values: Record<string, unknown>) =>
      Object.entries(values).map(([k, v]) => ({
        id: `cfid-${k}`,
        field_value: v as string | number | boolean | null,
      })),
    ),
  };
});

import { handleOptIn } from './ghl-adapter';
import { addContactToWorkflow } from './ghl';

const addToWorkflowMock = vi.mocked(addContactToWorkflow);

describe('handleOptIn — Trial Nurture enrolment (no double-enrol regression)', () => {
  beforeEach(() => {
    addToWorkflowMock.mockClear();
    vi.stubEnv('WORKFLOW_ID_TRIAL_NURTURE', 'wf_trial_nurture');
    vi.stubEnv('WORKFLOW_ID_ADMIN_NOTIFICATION', 'wf_admin_notif');
  });

  it('does not explicitly enrol a normal opt-in in Trial Nurture, but still notifies staff for contact-form leads', async () => {
    // Normal (non-contact-form) opt-in: GHL's own stage trigger ("Opt in
    // Message" -> TRIAL NURTURE stage trigger) is the ONLY thing that should
    // enrol this contact. An explicit addContactToWorkflow call here would
    // double-enrol the contact (the historical bug — Trial Nurture has Allow
    // Re-entry enabled, so both enrolments ran 24h apart, sending every
    // message twice).
    await handleOptIn({
      firstName: 'Jane',
      lastName: 'Doe',
      email: 'jane@example.com',
      phone: '+15551234567',
      source: 'homepage-optin',
      page: '/',
    });

    expect(addToWorkflowMock).not.toHaveBeenCalledWith(expect.anything(), 'wf_trial_nurture');

    addToWorkflowMock.mockClear();

    // Contact-form leads are a separate path that never touches Trial
    // Nurture — it must keep notifying staff via the admin workflow.
    await handleOptIn({
      firstName: 'John',
      lastName: 'Smith',
      email: 'john@example.com',
      phone: '+15559876543',
      source: 'contact-form',
      page: '/contact',
    });

    expect(addToWorkflowMock).toHaveBeenCalledWith('contact_1', 'wf_admin_notif');
  });
});
