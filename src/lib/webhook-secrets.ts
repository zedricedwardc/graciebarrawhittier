/**
 * Verify the X-GBW-Secret header on inbound webhooks from GHL.
 *
 * Why a header secret instead of HMAC signing:
 *   GHL Marketplace App webhooks are RSA-signed, but those require listing on
 *   the marketplace + OAuth installs. Workflow-triggered webhooks (which we use)
 *   are NOT signed. The mitigation per GHL's own guidance is a custom header
 *   set in the workflow's webhook action with a shared secret value.
 *
 * Configure in GHL:
 *   Workflow → Webhook action → Add Custom Header:
 *     Name:  X-GBW-Secret
 *     Value: <same as GHL_WEBHOOK_SECRET env var>
 */

import { timingSafeEqual } from 'node:crypto';

const HEADER_NAME = 'x-gbw-secret';

function readSecret(): string {
  const fromVite = (import.meta.env as Record<string, string | undefined>).GHL_WEBHOOK_SECRET;
  const s = fromVite ?? process.env.GHL_WEBHOOK_SECRET;
  if (!s || s.length < 16) {
    throw new Error('GHL_WEBHOOK_SECRET env var must be set to a string of length >= 16');
  }
  return s;
}

/**
 * Returns true iff the request's X-GBW-Secret header matches the configured
 * GHL_WEBHOOK_SECRET. Constant-time compare; never logs the actual secret.
 */
export function verifyGhlWebhook(req: Request): boolean {
  const provided = req.headers.get(HEADER_NAME) ?? req.headers.get('X-GBW-Secret') ?? '';
  if (!provided) return false;

  let expected: string;
  try {
    expected = readSecret();
  } catch {
    return false;
  }

  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
