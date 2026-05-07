/**
 * Zod schema + types for the opt-in / contact lead route.
 * Keeps the leads pipeline server-side so the public webhook URL never leaves the server.
 */
import { z } from 'zod';

export const LeadRequest = z.object({
  name: z.string().min(1).max(100),
  firstName: z.string().max(50).optional(),
  lastName: z.string().max(50).optional(),
  email: z.email(),
  phone: z.string().regex(/^\+?[\d\s\-().]{10,20}$/),
  message: z.string().max(2000).optional(),
  source: z.string().max(50),
  page: z.string().max(200),
  // Anti-spam
  website: z.string().optional(),
  ts: z.number().int(),
});
export type LeadRequest = z.infer<typeof LeadRequest>;

export type LeadResponse =
  | { ok: true }
  | { ok: false; code: 'INVALID_INPUT' | 'RATE_LIMITED' | 'WEBHOOK_FAILED' | 'NOT_CONFIGURED' };
