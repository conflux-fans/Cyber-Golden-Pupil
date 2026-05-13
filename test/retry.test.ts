import { test } from "node:test";
import assert from "node:assert/strict";
import { withRetry } from "../src/utils/retry.js";

// Helper: build an error that looks like an OpenAI/Anthropic SDK API error.
function apiError(status: number, headers?: Record<string, string>, message = "boom"): Error {
  const e = new Error(message) as Error & { status?: number; headers?: unknown };
  e.status = status;
  if (headers) e.headers = headers;
  return e;
}

test("withRetry returns first-call result without retrying", async () => {
  let calls = 0;
  const result = await withRetry(
    async () => {
      calls++;
      return "ok";
    },
    { maxRetries: 3, initialDelayMs: 1, maxDelayMs: 10 },
  );
  assert.equal(result, "ok");
  assert.equal(calls, 1);
});

test("withRetry retries on 429 and eventually succeeds", async () => {
  let calls = 0;
  const result = await withRetry(
    async () => {
      calls++;
      if (calls < 3) throw apiError(429);
      return "ok";
    },
    { maxRetries: 5, initialDelayMs: 1, maxDelayMs: 10 },
  );
  assert.equal(result, "ok");
  assert.equal(calls, 3);
});

test("withRetry retries on 5xx", async () => {
  let calls = 0;
  const result = await withRetry(
    async () => {
      calls++;
      if (calls === 1) throw apiError(503);
      return "ok";
    },
    { maxRetries: 3, initialDelayMs: 1, maxDelayMs: 10 },
  );
  assert.equal(result, "ok");
  assert.equal(calls, 2);
});

test("withRetry does NOT retry on 401 (auth)", async () => {
  let calls = 0;
  await assert.rejects(
    withRetry(
      async () => {
        calls++;
        throw apiError(401, undefined, "Unauthorized");
      },
      { maxRetries: 5, initialDelayMs: 1, maxDelayMs: 10 },
    ),
    /Unauthorized/,
  );
  assert.equal(calls, 1);
});

test("withRetry does NOT retry on 400 (bad request)", async () => {
  let calls = 0;
  await assert.rejects(
    withRetry(
      async () => {
        calls++;
        throw apiError(400, undefined, "Bad request");
      },
      { maxRetries: 5, initialDelayMs: 1, maxDelayMs: 10 },
    ),
    /Bad request/,
  );
  assert.equal(calls, 1);
});

test("withRetry exhausts maxRetries then throws", async () => {
  let calls = 0;
  await assert.rejects(
    withRetry(
      async () => {
        calls++;
        throw apiError(503, undefined, "Server down");
      },
      { maxRetries: 2, initialDelayMs: 1, maxDelayMs: 10 },
    ),
    /Server down/,
  );
  // maxRetries=2 means: 1 initial attempt + 2 retries = 3 total calls.
  assert.equal(calls, 3);
});

test("withRetry honors numeric Retry-After header", async () => {
  const delays: number[] = [];
  let calls = 0;
  await withRetry(
    async () => {
      calls++;
      if (calls === 1) throw apiError(429, { "retry-after": "0.05" }); // 50ms
      return "ok";
    },
    {
      // Set huge backoff to prove Retry-After wins over computed backoff.
      maxRetries: 3,
      initialDelayMs: 100_000,
      maxDelayMs: 200_000,
      onRetry: (info) => delays.push(info.delayMs),
    },
  );
  assert.equal(delays.length, 1);
  assert.equal(delays[0], 50);
});

test("withRetry caps Retry-After at maxDelayMs", async () => {
  const delays: number[] = [];
  let calls = 0;
  await withRetry(
    async () => {
      calls++;
      if (calls === 1) throw apiError(429, { "retry-after": "9999" }); // 9999s
      return "ok";
    },
    {
      maxRetries: 2,
      initialDelayMs: 1,
      maxDelayMs: 25, // cap at 25ms
      onRetry: (info) => delays.push(info.delayMs),
    },
  );
  assert.equal(delays[0], 25);
});

test("withRetry retries on network errors (ECONNRESET)", async () => {
  let calls = 0;
  const result = await withRetry(
    async () => {
      calls++;
      if (calls === 1) {
        const e = new Error("conn reset") as Error & { code?: string };
        e.code = "ECONNRESET";
        throw e;
      }
      return "ok";
    },
    { maxRetries: 3, initialDelayMs: 1, maxDelayMs: 10 },
  );
  assert.equal(result, "ok");
  assert.equal(calls, 2);
});

test("withRetry retries on APIConnectionError (matched by name)", async () => {
  let calls = 0;
  const result = await withRetry(
    async () => {
      calls++;
      if (calls === 1) {
        const e = new Error("connection failed");
        e.name = "APIConnectionError";
        throw e;
      }
      return "ok";
    },
    { maxRetries: 3, initialDelayMs: 1, maxDelayMs: 10 },
  );
  assert.equal(result, "ok");
});

test("withRetry classifies retry kind correctly in onRetry", async () => {
  const kinds: string[] = [];
  let calls = 0;
  await withRetry(
    async () => {
      calls++;
      if (calls === 1) throw apiError(429);
      if (calls === 2) throw apiError(502);
      if (calls === 3) {
        const e = new Error("net") as Error & { code?: string };
        e.code = "ETIMEDOUT";
        throw e;
      }
      return "ok";
    },
    {
      maxRetries: 5,
      initialDelayMs: 1,
      maxDelayMs: 10,
      onRetry: ({ kind }) => kinds.push(kind),
    },
  );
  assert.deepEqual(kinds, ["rate-limit", "server-error", "network"]);
});

test("withRetry tolerates Headers-like objects (header.get)", async () => {
  const delays: number[] = [];
  let calls = 0;
  await withRetry(
    async () => {
      calls++;
      if (calls === 1) {
        const e = new Error("rate") as Error & { status?: number; headers?: unknown };
        e.status = 429;
        // Headers-like object instead of plain dict.
        e.headers = {
          get(name: string): string | null {
            return name.toLowerCase() === "retry-after" ? "0.03" : null;
          },
        };
        throw e;
      }
      return "ok";
    },
    {
      maxRetries: 2,
      initialDelayMs: 100_000,
      maxDelayMs: 200_000,
      onRetry: (info) => delays.push(info.delayMs),
    },
  );
  assert.equal(delays[0], 30);
});
