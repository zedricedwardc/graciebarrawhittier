import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { trackEvent } from './analytics';

describe('trackEvent', () => {
  let originalWindow: typeof globalThis.window | undefined;

  beforeEach(() => {
    originalWindow = globalThis.window;
    // @ts-expect-error — test-only window stub
    globalThis.window = { dataLayer: [] };
  });

  afterEach(() => {
    // @ts-expect-error — restore
    globalThis.window = originalWindow;
  });

  it('pushes an event with the given name and payload', () => {
    trackEvent('generate_lead', { source: 'opt-in' });
    expect(globalThis.window!.dataLayer).toEqual([
      { event: 'generate_lead', source: 'opt-in' },
    ]);
  });

  it('pushes only the event name when no payload is provided', () => {
    trackEvent('booking_initiated');
    expect(globalThis.window!.dataLayer).toEqual([{ event: 'booking_initiated' }]);
  });

  it('no-ops when window is undefined (SSR)', () => {
    // @ts-expect-error — simulate SSR
    globalThis.window = undefined;
    expect(() => trackEvent('any', {})).not.toThrow();
  });

  it('no-ops when dataLayer is not an array (GTM not loaded)', () => {
    // @ts-expect-error — simulate GTM-disabled environment
    globalThis.window = {};
    expect(() => trackEvent('any', {})).not.toThrow();
  });
});
