import { describe, it, expect } from 'vitest';
import { SOURCES, SOURCE_TO_CHANNEL, channelForSource, LEAD_CHANNELS } from './lead-types';

describe('lead channel mapping', () => {
  it('maps every opt-in source to a valid dashboard channel', () => {
    for (const source of SOURCES) {
      const channel = channelForSource(source);
      expect(LEAD_CHANNELS).toContain(channel);
    }
  });

  it('routes all current website opt-in paths to Website', () => {
    expect(channelForSource('homepage-optin')).toBe('Website');
    expect(channelForSource('kids-optin')).toBe('Website');
    expect(channelForSource('adults-optin')).toBe('Website');
    expect(channelForSource('contact-form')).toBe('Website');
    // /offer QR landing page is still a website visit, not a front-desk Walk-In.
    expect(channelForSource('qr-offer-optin')).toBe('Website');
  });

  it('SOURCE_TO_CHANNEL has an entry for every source (no unmapped slug)', () => {
    expect(Object.keys(SOURCE_TO_CHANNEL).sort()).toEqual([...SOURCES].sort());
  });
});
