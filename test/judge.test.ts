import { test } from "node:test";
import assert from "node:assert/strict";
import { safeParseJudge, decideFromJudge } from "../src/analyzer/judge.js";
import type { Finding } from "../src/types.js";

const sampleFinding: Finding = {
  rule_id: "unsafe-deref",
  severity: "critical",
  file: "src/lib.rs",
  line_start: 10,
  line_end: 12,
  summary: "raw pointer deref",
  evidence: "*p = 1;",
  fix_suggestion: "validate p",
  confidence: 0.8,
};

test("safeParseJudge: parses clean JSON", () => {
  const text = JSON.stringify({
    verdict: "confirm",
    new_severity: "critical",
    reason: "real issue, untrusted input flows in",
    confidence: 0.9,
  });
  const j = safeParseJudge(text);
  assert.ok(j);
  assert.equal(j.verdict, "confirm");
  assert.equal(j.confidence, 0.9);
});

test("safeParseJudge: extracts JSON wrapped in prose", () => {
  const text = `After reviewing the full file, my decision:\n\n${JSON.stringify({
    verdict: "reject",
    reason: "evidence sits inside #[cfg(test)]",
    confidence: 0.95,
  })}\n\nDone.`;
  const j = safeParseJudge(text);
  assert.ok(j);
  assert.equal(j.verdict, "reject");
});

test("safeParseJudge: returns null on malformed text", () => {
  assert.equal(safeParseJudge("not json at all"), null);
  assert.equal(safeParseJudge("{ definitely not json"), null);
  assert.equal(safeParseJudge(""), null);
});

test("safeParseJudge: returns null when required fields are missing", () => {
  const text = JSON.stringify({ verdict: "confirm" }); // missing reason, confidence
  assert.equal(safeParseJudge(text), null);
});

test("safeParseJudge: rejects invalid verdict enum", () => {
  const text = JSON.stringify({
    verdict: "maybe",
    reason: "unsure",
    confidence: 0.5,
  });
  assert.equal(safeParseJudge(text), null);
});

test("safeParseJudge: rejects out-of-range confidence", () => {
  const text = JSON.stringify({
    verdict: "confirm",
    reason: "x",
    confidence: 1.5,
  });
  assert.equal(safeParseJudge(text), null);
});

test("decideFromJudge: confirm → keep", () => {
  const d = decideFromJudge(sampleFinding, {
    verdict: "confirm",
    reason: "real",
    confidence: 0.9,
  });
  assert.equal(d.kind, "keep");
});

test("decideFromJudge: reject → drop and carries reason", () => {
  const d = decideFromJudge(sampleFinding, {
    verdict: "reject",
    reason: "evidence inside #[cfg(test)]",
    confidence: 0.95,
  });
  assert.equal(d.kind, "drop");
  if (d.kind === "drop") assert.match(d.reason, /cfg\(test\)/);
});

test("decideFromJudge: downgrade with a different severity → downgrade", () => {
  const d = decideFromJudge(sampleFinding, {
    verdict: "downgrade",
    new_severity: "medium",
    reason: "limited blast radius",
    confidence: 0.8,
  });
  assert.equal(d.kind, "downgrade");
  if (d.kind === "downgrade") assert.equal(d.newSeverity, "medium");
});

test("decideFromJudge: downgrade to same severity → keep (no-op safety)", () => {
  const d = decideFromJudge(sampleFinding, {
    verdict: "downgrade",
    new_severity: "critical",
    reason: "same severity",
    confidence: 0.7,
  });
  assert.equal(d.kind, "keep");
});

test("decideFromJudge: downgrade without new_severity → keep (conservative default)", () => {
  const d = decideFromJudge(sampleFinding, {
    verdict: "downgrade",
    reason: "no severity given",
    confidence: 0.6,
  });
  assert.equal(d.kind, "keep");
});
