import type { Severity } from "../types.js";
import type {
  EvalSummary,
  FindingMatch,
  GroundTruth,
  GroundTruthEntry,
} from "./types.js";

/**
 * Compute the evaluation summary from per-finding match results.
 *
 * Recall is over `must_detect: true` entries only. `must_detect: false`
 * entries are bonus credit: hits count toward `bonus.hit` and toward
 * precision, but unmatched bonus entries do NOT count as a miss.
 *
 * Precision uses ALL matched reported findings (must + bonus) as the
 * numerator and total reported as denominator. Duplicate reports of the
 * same GT entry all count as true positives — we don't penalize the
 * scanner for surfacing the same bug twice, only for hallucinating.
 */
export function summarize(
  matches: FindingMatch[],
  gt: GroundTruth,
): EvalSummary {
  const mustEntries = gt.findings.filter((f) => f.must_detect);
  const bonusEntries = gt.findings.filter((f) => !f.must_detect);

  const hitIds = new Set<string>();
  let truePositives = 0;
  const falsePositives = [];

  for (const m of matches) {
    if (m.matchedId === null) {
      falsePositives.push(m.reported);
      continue;
    }
    truePositives++;
    hitIds.add(m.matchedId);
  }

  const mustHit = mustEntries.filter((e) => hitIds.has(e.id));
  const mustMissed = mustEntries.filter((e) => !hitIds.has(e.id));
  const bonusHit = bonusEntries.filter((e) => hitIds.has(e.id));

  const recall = mustEntries.length === 0 ? 1 : mustHit.length / mustEntries.length;
  const precision =
    matches.length === 0 ? 1 : truePositives / matches.length;

  return {
    target: gt.target,
    must: {
      total: mustEntries.length,
      hit: mustHit.length,
      missed: mustMissed,
    },
    bonus: {
      total: bonusEntries.length,
      hit: bonusHit.length,
    },
    reported: {
      total: matches.length,
      truePositives,
      falsePositives,
    },
    recall,
    precision,
    severityConfusion: buildSeverityConfusion(matches, gt),
  };
}

/**
 * Build a 5×5 confusion matrix indexed by `match_policy.severity_order`.
 * Rows are expected severity, columns are reported severity. Only true
 * positives contribute; false positives have no expected severity.
 */
function buildSeverityConfusion(
  matches: FindingMatch[],
  gt: GroundTruth,
): number[][] {
  const order = gt.match_policy.severity_order;
  const idx = new Map<Severity, number>();
  order.forEach((s, i) => idx.set(s, i));

  const m: number[][] = order.map(() => order.map(() => 0));
  for (const match of matches) {
    if (!match.expectedSeverity) continue;
    const ei = idx.get(match.expectedSeverity);
    const ri = idx.get(match.reported.severity);
    if (ei === undefined || ri === undefined) continue;
    m[ei]![ri]!++;
  }
  return m;
}

/**
 * The bugs the scanner failed to surface, in the original ground-truth
 * order. Convenience export for the CLI / JSON reporter.
 */
export function missedMustDetect(summary: EvalSummary): GroundTruthEntry[] {
  return summary.must.missed;
}
