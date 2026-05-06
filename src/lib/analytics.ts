/**
 * Pushes an event into the GTM dataLayer.
 * No-ops when dataLayer is absent (GTM not loaded, ad-blocker, dev without PUBLIC_GTM_ID).
 */
declare global {
  interface Window {
    dataLayer?: Array<Record<string, unknown>>;
  }
}

export function trackEvent(name: string, payload: Record<string, unknown> = {}): void {
  if (typeof window === 'undefined') return;
  if (!Array.isArray(window.dataLayer)) return;
  window.dataLayer.push({ event: name, ...payload });
}
