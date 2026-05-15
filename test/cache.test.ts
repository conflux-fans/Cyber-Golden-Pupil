import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ScanCache,
  chunkCacheKey,
  findingCacheKey,
  type ScanCacheKey,
} from "../src/analyzer/cache.js";
import type { Chunk, Finding } from "../src/types.js";

function makeChunk(overrides: Partial<Chunk> = {}): Chunk {
  return {
    file: {
      absPath: "/abs/foo.rs",
      relPath: "src/foo.rs",
      content: "fn foo() {}",
      language: "rust",
      crate: "demo",
    },
    startLine: 1,
    endLine: 10,
    content: "fn foo() { unsafe { *(0 as *const u8); } }",
    hints: ["unsafe"],
    ...overrides,
  };
}

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    rule_id: "rust.unsafe-deref",
    severity: "critical",
    file: "src/foo.rs",
    line_start: 3,
    line_end: 3,
    summary: "raw pointer deref",
    evidence: "*(0 as *const u8)",
    fix_suggestion: "remove",
    confidence: 0.9,
    ...overrides,
  };
}

function makeKey(over: Partial<ScanCacheKey> = {}): ScanCacheKey {
  return {
    projectPath: "/tmp/proj",
    provider: "kimi",
    model: "kimi-k2.6",
    unit: "ast-function",
    judge: true,
    crates: ["demo"],
    ...over,
  };
}

test("chunkCacheKey is stable for identical content and changes when content changes", () => {
  const a = chunkCacheKey(makeChunk());
  const b = chunkCacheKey(makeChunk());
  assert.equal(a, b);
  const c = chunkCacheKey(makeChunk({ content: "fn foo() { /* changed */ }" }));
  assert.notEqual(a, c);
});

test("findingCacheKey embeds rule_id, location, and evidence hash", () => {
  const k = findingCacheKey(makeFinding());
  assert.match(k, /src\/foo\.rs:3-3#rust\.unsafe-deref#[a-f0-9]+/);
  const k2 = findingCacheKey(makeFinding({ evidence: "different" }));
  assert.notEqual(k, k2);
});

test("ScanCache: round-trips chunks and judgements through disk", async () => {
  const dir = await mkdtemp(join(tmpdir(), "scan-cache-"));
  try {
    const path = ScanCache.computePath(dir, "demo", makeKey());
    const writer = new ScanCache(path);
    await writer.load();
    await writer.openForWrite(makeKey());

    const chunk = makeChunk();
    const cKey = chunkCacheKey(chunk);
    const finding = makeFinding();
    const fKey = findingCacheKey(finding);

    await writer.putChunk({
      chunkKey: cKey,
      findings: [finding],
      inputTokens: 50,
      outputTokens: 25,
    });
    await writer.putJudge({
      findingKey: fKey,
      decision: { kind: "drop", reason: "test-only" },
      inputTokens: 30,
      outputTokens: 5,
    });
    await writer.close();

    // New reader picks up everything we wrote.
    const reader = new ScanCache(path);
    const hits = await reader.load();
    assert.equal(hits.chunkHits, 1);
    assert.equal(hits.judgeHits, 1);

    const cachedChunk = reader.getChunk(cKey);
    assert.ok(cachedChunk);
    assert.equal(cachedChunk.findings.length, 1);
    assert.equal(cachedChunk.findings[0]?.rule_id, "rust.unsafe-deref");
    assert.equal(cachedChunk.inputTokens, 50);

    const cachedJudge = reader.getJudge(fKey);
    assert.ok(cachedJudge);
    assert.equal(cachedJudge.decision.kind, "drop");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ScanCache: tolerates corrupt/partial trailing line on resume", async () => {
  const dir = await mkdtemp(join(tmpdir(), "scan-cache-"));
  try {
    const path = ScanCache.computePath(dir, "demo", makeKey());
    const writer = new ScanCache(path);
    await writer.openForWrite(makeKey());
    await writer.putChunk({
      chunkKey: "k1",
      findings: [],
      inputTokens: 1,
      outputTokens: 1,
    });
    await writer.close();

    // Simulate a process killed mid-line: append a truncated record.
    const original = await readFile(path, "utf8");
    await writeFile(path, original + '{"type":"chunk","chunk', "utf8");

    const reader = new ScanCache(path);
    const hits = await reader.load();
    assert.equal(hits.chunkHits, 1, "good record still loads");
    assert.ok(reader.getChunk("k1"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ScanCache.computePath: same inputs → same path; differing inputs → different path", () => {
  const dir = "/tmp/cache";
  const a = ScanCache.computePath(dir, "demo", makeKey());
  const b = ScanCache.computePath(dir, "demo", makeKey());
  assert.equal(a, b);
  const c = ScanCache.computePath(dir, "demo", makeKey({ model: "different" }));
  assert.notEqual(a, c);
  const d = ScanCache.computePath(dir, "demo", makeKey({ crates: ["a", "b"] }));
  const e = ScanCache.computePath(dir, "demo", makeKey({ crates: ["b", "a"] }));
  assert.equal(d, e, "crate order should not affect the cache key");
});

test("ScanCache: appending after load preserves prior entries", async () => {
  const dir = await mkdtemp(join(tmpdir(), "scan-cache-"));
  try {
    const path = ScanCache.computePath(dir, "demo", makeKey());
    const w1 = new ScanCache(path);
    await w1.openForWrite(makeKey());
    await w1.putChunk({
      chunkKey: "first",
      findings: [],
      inputTokens: 1,
      outputTokens: 1,
    });
    await w1.close();

    const w2 = new ScanCache(path);
    await w2.load();
    await w2.openForWrite(makeKey());
    await w2.putChunk({
      chunkKey: "second",
      findings: [],
      inputTokens: 2,
      outputTokens: 2,
    });
    await w2.close();

    const reader = new ScanCache(path);
    const hits = await reader.load();
    assert.equal(hits.chunkHits, 2);
    assert.ok(reader.getChunk("first"));
    assert.ok(reader.getChunk("second"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
