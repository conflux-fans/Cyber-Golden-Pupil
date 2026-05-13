/**
 * Retry helper for LLM API calls.
 *
 * Treats the following as retryable:
 *   - HTTP 429 (rate limit)
 *   - HTTP 5xx (server errors)
 *   - Transient network errors (ECONNRESET / ETIMEDOUT / ENOTFOUND / EAI_AGAIN)
 *
 * Honors a `Retry-After` response header when present (seconds or HTTP-date),
 * otherwise applies exponential backoff with jitter, capped at `maxDelayMs`.
 */

export interface RetryOptions {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  /** Called before each retry sleep. `kind` distinguishes rate-limit from other retries. */
  onRetry?: (info: {
    attempt: number;
    delayMs: number;
    kind: "rate-limit" | "server-error" | "network";
    error: unknown;
  }) => void;
}

export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const info = classifyError(e);
      if (!info.retryable || attempt === opts.maxRetries) throw e;
      const delay = computeDelay(attempt, info.retryAfterMs, opts);
      opts.onRetry?.({ attempt: attempt + 1, delayMs: delay, kind: info.kind!, error: e });
      await sleep(delay);
    }
  }
  throw lastErr;
}

interface Classified {
  retryable: boolean;
  kind?: "rate-limit" | "server-error" | "network";
  retryAfterMs?: number;
}

function classifyError(e: unknown): Classified {
  if (typeof e !== "object" || e === null) return { retryable: false };
  const err = e as { status?: number; headers?: unknown; code?: string };

  if (err.status === 429) {
    return { retryable: true, kind: "rate-limit", retryAfterMs: parseRetryAfter(err.headers) };
  }
  if (typeof err.status === "number" && err.status >= 500 && err.status < 600) {
    return { retryable: true, kind: "server-error", retryAfterMs: parseRetryAfter(err.headers) };
  }

  const code = err.code;
  if (
    code === "ECONNRESET" ||
    code === "ETIMEDOUT" ||
    code === "ENOTFOUND" ||
    code === "EAI_AGAIN" ||
    code === "ECONNREFUSED"
  ) {
    return { retryable: true, kind: "network" };
  }

  // OpenAI SDK wraps low-level fetch failures in APIConnectionError without a status.
  const name = (e as { name?: string }).name;
  if (name === "APIConnectionError" || name === "APIConnectionTimeoutError") {
    return { retryable: true, kind: "network" };
  }

  return { retryable: false };
}

function computeDelay(attempt: number, retryAfterMs: number | undefined, opts: RetryOptions): number {
  if (retryAfterMs !== undefined && retryAfterMs > 0) {
    return Math.min(retryAfterMs, opts.maxDelayMs);
  }
  const base = Math.min(opts.maxDelayMs, opts.initialDelayMs * 2 ** attempt);
  const jitter = Math.random() * base * 0.25;
  return base + jitter;
}

function parseRetryAfter(headers: unknown): number | undefined {
  const raw = getHeader(headers, "retry-after");
  if (!raw) return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  // HTTP-date form
  const dateMs = Date.parse(raw);
  if (!Number.isNaN(dateMs)) {
    const delta = dateMs - Date.now();
    return delta > 0 ? delta : 0;
  }
  return undefined;
}

function getHeader(headers: unknown, name: string): string | undefined {
  if (!headers || typeof headers !== "object") return undefined;
  const lower = name.toLowerCase();
  const obj = headers as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (key.toLowerCase() === lower) {
      const v = obj[key];
      if (typeof v === "string") return v;
      if (Array.isArray(v) && typeof v[0] === "string") return v[0];
    }
  }
  const headersLike = headers as { get?: (n: string) => string | null };
  if (typeof headersLike.get === "function") {
    const v = headersLike.get(name);
    if (v) return v;
  }
  return undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
