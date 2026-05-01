/**
 * Counting semaphore + 429-aware exponential backoff.
 *
 * Why this and not naive Promise.all:
 * - We cap concurrent in-flight requests at `maxConcurrent` (default 5).
 * - On `Anthropic 429 / overloaded_error`, we sleep with exponential backoff
 *   honoring `retry-after` header when present, then retry up to 5 times.
 * - All other errors propagate up so the runner can record them.
 */

export class Semaphore {
  private permits: number;
  private waiters: Array<() => void> = [];

  constructor(permits: number) {
    this.permits = permits;
  }

  async acquire(): Promise<() => void> {
    if (this.permits > 0) {
      this.permits--;
      return () => this.release();
    }
    return new Promise<() => void>((resolve) => {
      this.waiters.push(() => resolve(() => this.release()));
    });
  }

  private release(): void {
    const next = this.waiters.shift();
    if (next) next();
    else this.permits++;
  }
}

export interface BackoffOpts {
  maxRetries: number;
  baseMs: number;
  maxMs: number;
  /** Test-only override so we don't actually sleep. */
  sleepFn?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function isRateLimitError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { status?: number; error?: { type?: string }; message?: string };
  if (e.status === 429 || e.status === 529) return true;
  if (e.error?.type === "overloaded_error" || e.error?.type === "rate_limit_error") return true;
  if (typeof e.message === "string" && /429|overloaded|rate.?limit/i.test(e.message)) return true;
  return false;
}

export function getRetryAfterMs(err: unknown): number | null {
  if (!err || typeof err !== "object") return null;
  const headers = (err as { headers?: Record<string, string> }).headers;
  if (!headers) return null;
  const ra = headers["retry-after"] ?? headers["Retry-After"];
  if (!ra) return null;
  const n = parseFloat(ra);
  if (Number.isFinite(n)) return Math.max(0, n * 1000);
  return null;
}

/**
 * Run `fn`, retrying on rate-limit / overload up to `maxRetries` times with
 * exponential backoff (jittered). Non-rate-limit errors propagate immediately.
 */
export async function withBackoff<T>(
  fn: () => Promise<T>,
  opts: Partial<BackoffOpts> = {},
): Promise<T> {
  const { maxRetries = 5, baseMs = 500, maxMs = 30_000, sleepFn = defaultSleep } = opts;
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err) {
      if (!isRateLimitError(err) || attempt >= maxRetries) throw err;
      const ra = getRetryAfterMs(err);
      const expo = Math.min(maxMs, baseMs * 2 ** attempt);
      const jitter = Math.floor(Math.random() * 250);
      const wait = ra ?? expo + jitter;
      await sleepFn(wait);
      attempt++;
    }
  }
}
