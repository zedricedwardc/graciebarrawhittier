/**
 * GHL fetch wrapper — the single point through which all GHL API traffic flows.
 *
 * Why a wrapper:
 *   1. Per-call Version header. Different GHL resources require different versions
 *      ("2021-04-15" for calendars, "2021-07-28" for newer endpoints). A single
 *      global VERSION will silently 422 on newer endpoints — see `ghl-research`
 *      doc Risk #1.
 *   2. Surface X-RateLimit-Remaining to logs. GHL has a 100 req/10s burst limit;
 *      we need visibility before we hit it.
 *   3. Soft back-pressure: when remaining drops below 5, sleep briefly to avoid
 *      tipping into 429.
 *   4. Single place to evolve telemetry, retries, and observability.
 *
 * NOT a retry layer. Retries are intentionally caller's responsibility — we don't
 * know whether a given GHL call is idempotent (some are, some aren't). The wrapper
 * surfaces errors faithfully.
 */

const BASE = 'https://services.leadconnectorhq.com';

/** Default API version — bump cautiously; some endpoints regress on newer headers. */
export const DEFAULT_VERSION = '2021-07-28';

/** When X-RateLimit-Remaining is at or below this, sleep before the next call. */
const BACK_PRESSURE_THRESHOLD = 5;
const MAX_BACK_PRESSURE_SLEEP_MS = 1000;

export class GhlError extends Error {
  override name = 'GhlError';
  status: number;
  bodyText: string;
  path: string;
  constructor(status: number, bodyText: string, path: string, msg: string) {
    super(msg);
    this.status = status;
    this.bodyText = bodyText;
    this.path = path;
  }
}

export interface GhlFetchOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  /** Plain-object body — will be JSON-stringified. Use raw `body` for special cases. */
  json?: unknown;
  /** Raw body string. Mutually exclusive with `json`. */
  body?: string;
  /** Override the Version header for this call. Defaults to DEFAULT_VERSION. */
  version?: string;
  /** Extra headers (e.g. for endpoints that need a special content-type). */
  headers?: Record<string, string>;
  /** Skip rate-limit back-pressure (e.g. health checks). */
  skipBackPressure?: boolean;
}

export interface RateLimitState {
  /** X-RateLimit-Remaining (per 10s burst window). */
  burstRemaining: number;
  /** X-RateLimit-Daily-Remaining. */
  dailyRemaining: number;
  /** Wall-clock ms when the window resets (best-effort). */
  windowResetMs: number | null;
  /** Wall-clock ms when this state was last updated. */
  updatedAt: number;
}

/**
 * Module-scoped rate-limit state. Lives on a warm Fluid Compute instance.
 * Cold starts reset to optimistic defaults — fine because the next response
 * updates the state from real headers.
 */
let rateLimitState: RateLimitState = {
  burstRemaining: 100,
  dailyRemaining: 200_000,
  windowResetMs: null,
  updatedAt: 0,
};

export function currentRateLimit(): RateLimitState {
  return { ...rateLimitState };
}

function readEnv(key: string): string | undefined {
  const fromVite = (import.meta.env as Record<string, string | undefined>)[key];
  return fromVite ?? process.env[key];
}

function token(): string {
  const t = readEnv('GHL_PIT_TOKEN');
  if (!t) throw new Error('GHL_PIT_TOKEN env var not set');
  return t;
}

function updateRateLimitFromHeaders(headers: Headers): void {
  const burst = Number(headers.get('x-ratelimit-remaining'));
  const daily = Number(headers.get('x-ratelimit-daily-remaining'));
  const intervalMs = Number(headers.get('x-ratelimit-interval-milliseconds'));
  rateLimitState = {
    burstRemaining: Number.isFinite(burst) ? burst : rateLimitState.burstRemaining,
    dailyRemaining: Number.isFinite(daily) ? daily : rateLimitState.dailyRemaining,
    windowResetMs: Number.isFinite(intervalMs) ? Date.now() + intervalMs : rateLimitState.windowResetMs,
    updatedAt: Date.now(),
  };
}

async function applyBackPressure(): Promise<void> {
  const { burstRemaining, windowResetMs, updatedAt } = rateLimitState;
  // Only back-pressure if the state is recent (within last 30s) and remaining is low.
  if (Date.now() - updatedAt > 30_000) return;
  if (burstRemaining > BACK_PRESSURE_THRESHOLD) return;

  // Sleep until the window resets, capped at MAX_BACK_PRESSURE_SLEEP_MS.
  const now = Date.now();
  const untilReset = windowResetMs ? Math.max(0, windowResetMs - now) : 200;
  const sleep = Math.min(MAX_BACK_PRESSURE_SLEEP_MS, untilReset);
  if (sleep > 0) await new Promise((r) => setTimeout(r, sleep));
}

/**
 * Issue a GHL API call. Throws GhlError on non-2xx.
 *
 * Example:
 *   const data = await ghlFetch<{ contact: { id: string } }>('/contacts/upsert', {
 *     method: 'POST',
 *     json: { locationId, email, phone },
 *   });
 */
export async function ghlFetch<T = unknown>(path: string, options: GhlFetchOptions = {}): Promise<T> {
  const method = options.method ?? 'GET';
  const version = options.version ?? DEFAULT_VERSION;

  if (options.json !== undefined && options.body !== undefined) {
    throw new Error('ghlFetch: pass either `json` or `body`, not both');
  }

  if (!options.skipBackPressure) await applyBackPressure();

  const body = options.json !== undefined ? JSON.stringify(options.json) : options.body;

  const res = await fetch(`${BASE}${path}`, {
    method,
    body,
    headers: {
      Authorization: `Bearer ${token()}`,
      Version: version,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  });

  updateRateLimitFromHeaders(res.headers);

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new GhlError(
      res.status,
      text,
      path,
      `GHL ${method} ${path} ${res.status}: ${text.slice(0, 200)}`,
    );
  }

  // 204 No Content
  if (res.status === 204) return undefined as T;

  return (await res.json()) as T;
}
