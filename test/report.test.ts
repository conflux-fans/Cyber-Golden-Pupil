import { test } from "node:test";
import assert from "node:assert/strict";
import { buildReport, countLines, defaultReportFilename } from "../src/reporter/report.js";
import type { Finding } from "../src/types.js";

test("countLines: empty file is zero", () => {
  assert.equal(countLines(""), 0);
});

test("countLines: file ending with newline does not count the empty tail", () => {
  assert.equal(countLines("a\nb\nc\n"), 3);
});

test("countLines: file without final newline counts its last partial line", () => {
  assert.equal(countLines("a\nb\nc"), 3);
});

test("countLines: single line without newline counts as one", () => {
  assert.equal(countLines("just-one"), 1);
});

test("defaultReportFilename: joins project/provider/model with dashes and uses .html extension", () => {
  assert.equal(
    defaultReportFilename("my-app", "kimi", "kimi-k2.6"),
    "my-app-kimi-kimi-k2.6.html",
  );
});

test("defaultReportFilename: replaces path separators in model id (OpenRouter style)", () => {
  assert.equal(
    defaultReportFilename("hyper", "openrouter", "anthropic/claude-sonnet-4"),
    "hyper-openrouter-anthropic-claude-sonnet-4.html",
  );
});

test("defaultReportFilename: collapses whitespace and trims dashes/dots", () => {
  assert.equal(
    defaultReportFilename("  My  App  ", ".kimi.", "k2 .6"),
    "My-App-kimi-k2-.6.html",
  );
});

test("defaultReportFilename: falls back to 'scan' for empty parts", () => {
  assert.equal(
    defaultReportFilename("", "", ""),
    "scan-scan-scan.html",
  );
});

test("buildReport: produces valid JSON with all expected sections", () => {
  const finding: Finding = {
    rule_id: "x",
    severity: "high",
    file: "src/lib.rs",
    line_start: 1,
    line_end: 2,
    summary: "y",
    evidence: "z",
    fix_suggestion: "f",
    confidence: 0.7,
    crate: "demo",
  };
  const body = buildReport({
    startedAt: new Date("2026-01-01T10:00:00Z"),
    finishedAt: new Date("2026-01-01T10:00:05Z"),
    project: {
      name: "demo",
      path: "/tmp/demo",
      isWorkspace: false,
      crates: ["demo"],
    },
    fileCount: 3,
    lineCount: 42,
    provider: {
      name: "kimi",
      model: "kimi-k2.6",
      baseUrl: "https://api.moonshot.cn/v1",
      protocol: "openai",
    },
    config: { unit: "ast-function", concurrency: 4, maxRetries: 5, judge: true },
    stats: {
      inputTokens: 100,
      outputTokens: 50,
      analyzeCalls: 2,
      judgeCalls: 1,
      chunkCacheHits: 0,
      judgeCacheHits: 0,
    },
    findings: [finding],
  });
  const obj = JSON.parse(body);
  assert.equal(obj.scan.duration_ms, 5000);
  assert.equal(obj.project.name, "demo");
  assert.equal(obj.project.file_count, 3);
  assert.equal(obj.project.line_count, 42);
  assert.equal(obj.model.provider, "kimi");
  assert.equal(obj.model.model, "kimi-k2.6");
  assert.equal(obj.tokens.input, 100);
  assert.equal(obj.tokens.output, 50);
  assert.equal(obj.tokens.total, 150);
  assert.equal(obj.tokens.analyze_calls, 2);
  assert.equal(obj.tokens.judge_calls, 1);
  assert.equal(obj.config.unit, "ast-function");
  assert.equal(obj.findings.length, 1);
  assert.equal(obj.findings[0].rule_id, "x");
});
