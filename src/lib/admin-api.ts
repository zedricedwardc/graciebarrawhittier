/**
 * Shared helpers for the admin blog API routes.
 *
 * Server-only. Centralizes admin-token verification (read from the `t` query
 * param OR the `x-admin-token` header) and the JSON response shape so every
 * route enforces auth identically before any write.
 */

import { verifyAdminToken } from './admin-token';

export interface AdminApiBody {
  ok: boolean;
  code?: string;
  [k: string]: unknown;
}

/** Build a JSON Response with an explicit HTTP status (matches the blog spec). */
export function json(status: number, body: AdminApiBody): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export type AdminAuth = { ok: true } | { ok: false };

/**
 * Verify the admin token from the `t` query param or `x-admin-token` header.
 * Returns { ok:false } if missing/invalid/expired — callers respond 401
 * INVALID_TOKEN. Never reveals the specific failure reason to the client.
 */
export function requireAdmin(request: Request, url: URL): AdminAuth {
  const token = url.searchParams.get('t') ?? request.headers.get('x-admin-token') ?? '';
  if (!token) return { ok: false };
  const verified = verifyAdminToken(token);
  return verified.ok ? { ok: true } : { ok: false };
}
