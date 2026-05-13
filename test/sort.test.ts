import { test } from "node:test";
import assert from "node:assert/strict";
import { sortFindingsBySeverity } from "../src/analyzer/runner.js";
import type { Finding, Severity } from "../src/types.js";

function f(
  severity: Severity,
  overrides: Partial<Finding> = {},
): Finding {
  return {
    rule_id: `rule-${severity}`,
    severity,
    file: "src/lib.rs",
    line_start: 1,
    line_end: 1,
    summary: "s",
    evidence: "e",
    fix_suggestion: "fix",
    confidence: 0.5,
    ...overrides,
  };
}

test("sortFindingsBySeverity: orders critical → high → medium → low → info", () => {
  const input = [f("info"), f("medium"), f("critical"), f("low"), f("high")];
  const out = sortFindingsBySeverity(input);
  assert.deepEqual(
    out.map((x) => x.severity),
    ["critical", "high", "medium", "low", "info"],
  );
});

test("sortFindingsBySeverity: tie-breaks within same severity by confidence desc", () => {
  const a = f("high", { rule_id: "a", confidence: 0.3 });
  const b = f("high", { rule_id: "b", confidence: 0.9 });
  const c = f("high", { rule_id: "c", confidence: 0.6 });
  const out = sortFindingsBySeverity([a, b, c]);
  assert.deepEqual(out.map((x) => x.rule_id), ["b", "c", "a"]);
});

test("sortFindingsBySeverity: stable across same severity and confidence (file/line)", () => {
  const a = f("medium", { file: "src/b.rs", line_start: 10, rule_id: "a" });
  const b = f("medium", { file: "src/a.rs", line_start: 20, rule_id: "b" });
  const c = f("medium", { file: "src/a.rs", line_start: 5, rule_id: "c" });
  const out = sortFindingsBySeverity([a, b, c]);
  // src/a.rs:5 (c), src/a.rs:20 (b), src/b.rs:10 (a)
  assert.deepEqual(out.map((x) => x.rule_id), ["c", "b", "a"]);
});

test("sortFindingsBySeverity: does not mutate the input array", () => {
  const input = [f("info"), f("critical")];
  const snapshot = input.map((x) => x.severity);
  sortFindingsBySeverity(input);
  assert.deepEqual(input.map((x) => x.severity), snapshot);
});

test("sortFindingsBySeverity: empty input returns empty array", () => {
  assert.deepEqual(sortFindingsBySeverity([]), []);
});
