import type { Finding, Severity } from "../types.js";

export interface GroundTruthEntry {
  id: string;
  file: string;
  line_start: number;
  line_end: number;
  category: string;
  cwe?: string;
  severity: Severity;
  must_detect: boolean;
  aliases: string[];
  notes?: string;
}

export interface MatchPolicy {
  line_slack: number;
  severity_order: Severity[];
}

export interface GroundTruth {
  target: string;
  schema_version: number;
  match_policy: MatchPolicy;
  findings: GroundTruthEntry[];
}

/**
 * A single reported finding's evaluation outcome. Each reported finding
 * produces exactly one of these. `matchedId` is null iff the finding is a
 * false positive.
 */
export interface FindingMatch {
  reported: Finding;
  matchedId: string | null;
  matchKind: "must" | "bonus" | "none";
  expectedSeverity?: Severity;
}

export interface EvalSummary {
  target: string;
  must: { total: number; hit: number; missed: GroundTruthEntry[] };
  bonus: { total: number; hit: number };
  reported: { total: number; truePositives: number; falsePositives: Finding[] };
  recall: number;
  precision: number;
  /** [expectedIndex][reportedIndex] using policy.severity_order; only counts true-positive must-detect hits. */
  severityConfusion: number[][];
}
