import { test } from "node:test";
import assert from "node:assert/strict";
import { renderHtmlReport } from "../src/reporter/html.js";
import type { Finding } from "../src/types.js";
import type { ReportArgs } from "../src/reporter/report.js";

function baseArgs(findings: Finding[]): ReportArgs {
  return {
    startedAt: new Date("2026-01-01T10:00:00Z"),
    finishedAt: new Date("2026-01-01T10:00:05Z"),
    project: { name: "demo", path: "/tmp/demo", isWorkspace: false, crates: ["demo"] },
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
    findings,
  };
}

function makeFinding(overrides: Partial<Finding>): Finding {
  return {
    rule_id: "rule-x",
    severity: "high",
    file: "src/lib.rs",
    line_start: 10,
    line_end: 12,
    summary: "summary text",
    evidence: "unsafe { *p = 1; }",
    fix_suggestion: "validate p",
    confidence: 0.7,
    crate: "demo",
    ...overrides,
  };
}

test("renderHtmlReport: produces a self-contained HTML document", () => {
  const html = renderHtmlReport(baseArgs([makeFinding({})]));
  assert.match(html, /^<!DOCTYPE html>/);
  assert.match(html, /<html lang="en">/);
  assert.match(html, /<\/html>\s*$/);
  // No external resources.
  assert.doesNotMatch(html, /<link [^>]*rel="stylesheet"/);
  assert.doesNotMatch(html, /<script\b/);
});

test("renderHtmlReport: includes core meta fields (project, model, tokens, LoC)", () => {
  const html = renderHtmlReport(baseArgs([]));
  assert.match(html, /demo/); // project name
  assert.match(html, /\/tmp\/demo/); // path
  assert.match(html, /kimi/);
  assert.match(html, /kimi-k2\.6/);
  assert.match(html, /Lines of code/);
  assert.match(html, />42</); // line count appears in a cell
  assert.match(html, /Total tokens/);
  assert.match(html, />150</); // total tokens
});

test("renderHtmlReport: empty findings shows a friendly message, not an empty table", () => {
  const html = renderHtmlReport(baseArgs([]));
  assert.match(html, /No findings\./);
  assert.doesNotMatch(html, /<table class="findings">/);
});

test("renderHtmlReport: escapes HTML-sensitive characters in evidence (XSS guard)", () => {
  const evil = makeFinding({
    evidence: '<script>alert("xss")</script>',
    summary: "summary with <tag> & ampersand",
    fix_suggestion: 'replace "X" with Y',
  });
  const html = renderHtmlReport(baseArgs([evil]));
  // Raw injection must not appear.
  assert.doesNotMatch(html, /<script>alert/);
  // Escaped forms must appear.
  assert.match(html, /&lt;script&gt;alert\(&quot;xss&quot;\)/);
  assert.match(html, /summary with &lt;tag&gt; &amp; ampersand/);
});

test("renderHtmlReport: applies a severity CSS class to each finding", () => {
  const findings = [
    makeFinding({ severity: "critical", rule_id: "r-crit" }),
    makeFinding({ severity: "info", rule_id: "r-info" }),
  ];
  const html = renderHtmlReport(baseArgs(findings));
  assert.match(html, /class="sev sev-critical">critical</);
  assert.match(html, /class="sev sev-info">info</);
});

test("renderHtmlReport: renders findings in the order they appear in the array", () => {
  // The runner sorts by severity before passing the array in — this test
  // confirms that the renderer faithfully preserves that order.
  const findings = [
    makeFinding({ severity: "critical", rule_id: "r1" }),
    makeFinding({ severity: "high", rule_id: "r2" }),
    makeFinding({ severity: "medium", rule_id: "r3" }),
    makeFinding({ severity: "low", rule_id: "r4" }),
    makeFinding({ severity: "info", rule_id: "r5" }),
  ];
  const html = renderHtmlReport(baseArgs(findings));
  const positions = findings.map((f) => html.indexOf(f.rule_id));
  for (let i = 1; i < positions.length; i++) {
    assert.ok(positions[i]! > positions[i - 1]!, `${findings[i]!.rule_id} should come after ${findings[i - 1]!.rule_id}`);
  }
});
