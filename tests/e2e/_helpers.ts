/**
 * Shared helpers for E2E tests.
 * Test data is intentionally identifiable so it can be cleaned up in GHL afterwards.
 */
import { request as plRequest, type APIRequestContext } from '@playwright/test';

export const TEST_RUN_ID = `qa-${Date.now()}`;

export const TEST_PARENT = {
  firstName: 'QATest',
  lastName: 'Bot',
  email: `qa-test-${Date.now()}@example.com`,
  phone: '5625550100',
};

export const TEST_TRAINEE_ADULT = {
  firstName: 'QATest',
  age: 25,
  isSelf: true,
};

export const PROGRAMS = ['tiny', 'lc1', 'lc2', 'juniors', 'adults'] as const;

export function todayInLA(): { year: number; month: number; day: number } {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const iso = fmt.format(new Date());
  const parts = iso.split('-').map(Number);
  return { year: parts[0]!, month: parts[1]!, day: parts[2]! };
}

export function isoDateOffset(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export async function newApiContext(baseURL: string): Promise<APIRequestContext> {
  return await plRequest.newContext({ baseURL });
}
