import { describe, it, expect } from 'vitest';
import { SOURCES, LEAD_SOURCES, channelForSource, pageLabelForSource, LEAD_CHANNELS } from './lead-types';
import { OPTIN_PAGE_LABELS } from '../../config/ghl-schema';

describe('lead source registry', () => {
  it('maps every opt-in source to a valid dashboard channel', () => {
    for (const source of SOURCES) {
      expect(LEAD_CHANNELS).toContain(channelForSource(source));
    }
  });

  it('maps every opt-in source to a valid optin_page label', () => {
    for (const source of SOURCES) {
      expect(OPTIN_PAGE_LABELS).toContain(pageLabelForSource(source));
    }
  });

  it('routes page opt-ins to the Website Leads channel', () => {
    expect(channelForSource('homepage-optin')).toBe('Website Leads');
    expect(channelForSource('kids-optin')).toBe('Website Leads');
    expect(channelForSource('adults-optin')).toBe('Website Leads');
    expect(channelForSource('contact-form')).toBe('Website Leads');
  });

  it('routes the /offer QR landing page to the Walk-In channel', () => {
    expect(channelForSource('qr-offer-optin')).toBe('Walk-In');
  });

  it('gives each website opt-in path a readable page label', () => {
    expect(pageLabelForSource('homepage-optin')).toBe('Homepage');
    expect(pageLabelForSource('kids-optin')).toBe('Kids Page');
    expect(pageLabelForSource('adults-optin')).toBe('Adults Page');
    expect(pageLabelForSource('contact-form')).toBe('Contact Page');
    expect(pageLabelForSource('qr-offer-optin')).toBe('Offer Page (QR)');
  });

  it('SOURCES matches the registry keys exactly (no unmapped slug)', () => {
    expect([...SOURCES].sort()).toEqual(Object.keys(LEAD_SOURCES).sort());
  });

  it('routes chat-widget to the Website Chat channel', () => {
    expect(channelForSource('chat-widget')).toBe('Website Chat');
  });

  it('gives chat-widget a readable page label', () => {
    expect(pageLabelForSource('chat-widget')).toBe('Chat Widget');
  });

  it('includes Website Chat in the LEAD_CHANNELS enum', () => {
    expect(LEAD_CHANNELS).toContain('Website Chat');
  });
});
