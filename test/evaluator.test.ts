import { test } from "node:test";
import assert from "node:assert/strict";
import { matchFindings } from "../src/evaluator/matcher.js";
import { summarize } from "../src/evaluator/metrics.js";
import type { Finding } from "../src/types.js";
import type { GroundTruth } from "../src/evaluator/types.js";

const baseGt: GroundTruth = {
  target: "fixture",
  schema_version: 1,
  match_policy: {
    line_slack: 5,
    severity_order: ["info", "low", "medium", "high", "critical"],
  },
  findings: [
    {
      id: "sqli-1",
      file: "src/db.rs",
      line_start: 10,
      line_end: 15,
      category: "sql-injection",
      severity: "critical",
      must_detect: true,
      aliases: ["sqli", "tainted-sql"],
    },
    {
      id: "weak-hash-1",
      file: "src/auth.rs",
      line_start: 30,
      line_end: 40,
      category: "weak-crypto",
      severity: "high",
      must_detect: true,
      aliases: [],
    },
    {
      id: "bonus-unwrap",
      file: "src/db.rs",
      line_start: 14,
      line_end: 14,
      category: "panic-unwrap",
      severity: "low",
      must_detect: false,
      aliases: ["unwrap"],
    },
  ],
};

function fakeFinding(over: Partial<Finding>): Finding {
  return {
    rule_id: "x",
    severity: "medium",
    file: "src/x.rs",
    line_start: 1,
    line_end: 1,
    summary: "",
    evidence: "",
    fix_suggestion: "",
    confidence: 0.5,
    ...over,
  };
}

test("matcher: exact line range and canonical category match", () => {
  const r = fakeFinding({
    rule_id: "sql-injection",
    file: "src/db.rs",
    line_start: 11,
    line_end: 14,
  });
  const [m] = matchFindings([r], baseGt);
  assert.equal(m!.matchedId, "sqli-1");
  assert.equal(m!.matchKind, "must");
});

test("matcher: alias match counts", () => {
  const r = fakeFinding({
    rule_id: "sqli",
    file: "src/db.rs",
    line_start: 12,
    line_end: 12,
  });
  const [m] = matchFindings([r], baseGt);
  assert.equal(m!.matchedId, "sqli-1");
});

test("matcher: separator-insensitive (sql_injection == sql-injection)", () => {
  const r = fakeFinding({
    rule_id: "sql_injection",
    file: "src/db.rs",
    line_start: 12,
    line_end: 12,
  });
  const [m] = matchFindings([r], baseGt);
  assert.equal(m!.matchedId, "sqli-1");
});

test("matcher: line outside slack window does NOT match", () => {
  // slack=5, GT range 10-15 → window 5..20. Line 21 is outside.
  const r = fakeFinding({
    rule_id: "sql-injection",
    file: "src/db.rs",
    line_start: 21,
    line_end: 22,
  });
  const [m] = matchFindings([r], baseGt);
  assert.equal(m!.matchedId, null);
});

test("matcher: line inside slack window matches", () => {
  // slack=5, GT range 10-15 → window 5..20. Line 6 is inside.
  const r = fakeFinding({
    rule_id: "sql-injection",
    file: "src/db.rs",
    line_start: 6,
    line_end: 6,
  });
  const [m] = matchFindings([r], baseGt);
  assert.equal(m!.matchedId, "sqli-1");
});

test("matcher: different file does NOT match", () => {
  const r = fakeFinding({
    rule_id: "sql-injection",
    file: "src/other.rs",
    line_start: 12,
    line_end: 12,
  });
  const [m] = matchFindings([r], baseGt);
  assert.equal(m!.matchedId, null);
});

test("matcher: same lines but wrong category does NOT match", () => {
  const r = fakeFinding({
    rule_id: "buffer-overflow",
    file: "src/db.rs",
    line_start: 12,
    line_end: 12,
  });
  const [m] = matchFindings([r], baseGt);
  assert.equal(m!.matchedId, null);
});

test("matcher: bonus entry is reported with matchKind=bonus", () => {
  const r = fakeFinding({
    rule_id: "unwrap",
    file: "src/db.rs",
    line_start: 14,
    line_end: 14,
  });
  const [m] = matchFindings([r], baseGt);
  assert.equal(m!.matchedId, "bonus-unwrap");
  assert.equal(m!.matchKind, "bonus");
});

test("matcher: between overlapping GT entries, picks the closest midpoint", () => {
  // GT entries on src/db.rs:
  //   sqli-1     lines 10-15 (mid=12.5)
  //   bonus-unwrap line 14   (mid=14)
  // A reported finding at line 14 with the "unwrap" rule should pick
  // bonus-unwrap (closer midpoint AND only category match).
  const r = fakeFinding({
    rule_id: "unwrap",
    file: "src/db.rs",
    line_start: 14,
    line_end: 14,
  });
  const [m] = matchFindings([r], baseGt);
  assert.equal(m!.matchedId, "bonus-unwrap");
});

test("metrics: recall counts only must_detect entries", () => {
  const reported = [
    fakeFinding({
      rule_id: "sql-injection",
      file: "src/db.rs",
      line_start: 10,
      line_end: 15,
    }),
  ];
  const matches = matchFindings(reported, baseGt);
  const s = summarize(matches, baseGt);
  // 1 of 2 must_detect entries hit.
  assert.equal(s.must.total, 2);
  assert.equal(s.must.hit, 1);
  assert.equal(s.recall, 0.5);
});

test("metrics: bonus hit does not change recall", () => {
  const reported = [
    fakeFinding({
      rule_id: "unwrap",
      file: "src/db.rs",
      line_start: 14,
      line_end: 14,
    }),
  ];
  const matches = matchFindings(reported, baseGt);
  const s = summarize(matches, baseGt);
  assert.equal(s.bonus.hit, 1);
  assert.equal(s.must.hit, 0);
  assert.equal(s.recall, 0);
  // Precision is still 1.0 — the report wasn't a false positive.
  assert.equal(s.precision, 1);
});

test("metrics: false positive lowers precision but not recall", () => {
  const reported = [
    fakeFinding({
      rule_id: "sql-injection",
      file: "src/db.rs",
      line_start: 10,
      line_end: 15,
    }),
    fakeFinding({
      rule_id: "hallucination",
      file: "src/lib.rs",
      line_start: 1,
      line_end: 5,
    }),
  ];
  const matches = matchFindings(reported, baseGt);
  const s = summarize(matches, baseGt);
  assert.equal(s.reported.truePositives, 1);
  assert.equal(s.reported.falsePositives.length, 1);
  assert.equal(s.precision, 0.5);
  assert.equal(s.recall, 0.5);
});

test("metrics: severity confusion places hits at [expected][reported]", () => {
  // GT sqli-1 is severity=critical. We report severity=high → confusion[4][3]=1.
  const reported = [
    fakeFinding({
      rule_id: "sql-injection",
      severity: "high",
      file: "src/db.rs",
      line_start: 10,
      line_end: 15,
    }),
  ];
  const matches = matchFindings(reported, baseGt);
  const s = summarize(matches, baseGt);
  // severity_order = ["info","low","medium","high","critical"]
  // expected=critical (index 4), reported=high (index 3)
  assert.equal(s.severityConfusion[4]![3], 1);
  // No other cells populated.
  let total = 0;
  for (const row of s.severityConfusion) for (const v of row) total += v;
  assert.equal(total, 1);
});

test("metrics: empty ground truth → recall=1 by convention", () => {
  const emptyGt: GroundTruth = { ...baseGt, findings: [] };
  const s = summarize([], emptyGt);
  assert.equal(s.recall, 1);
  assert.equal(s.precision, 1);
});

test("metrics: duplicate reports of the same GT entry both count as TP", () => {
  const reported = [
    fakeFinding({
      rule_id: "sql-injection",
      file: "src/db.rs",
      line_start: 10,
      line_end: 15,
    }),
    fakeFinding({
      rule_id: "tainted-sql",
      file: "src/db.rs",
      line_start: 11,
      line_end: 14,
    }),
  ];
  const matches = matchFindings(reported, baseGt);
  const s = summarize(matches, baseGt);
  // Both findings match the same GT entry; neither is a false positive.
  assert.equal(s.reported.truePositives, 2);
  assert.equal(s.reported.falsePositives.length, 0);
  // But the GT entry is only counted once toward recall.
  assert.equal(s.must.hit, 1);
});
