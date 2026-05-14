import type { Finding } from "../types.js";
import type { FindingMatch, GroundTruth, GroundTruthEntry } from "./types.js";

/**
 * Decide which ground-truth entry (if any) a reported finding corresponds to.
 *
 * A reported finding matches a GT entry when:
 *   1. file path is identical (case-sensitive),
 *   2. reported [line_start, line_end] overlaps GT range extended by
 *      `match_policy.line_slack` lines on each side,
 *   3. reported `rule_id` (lower-cased) equals GT `category` or any
 *      alias, also lower-cased.
 *
 * If multiple GT entries pass the gate, we pick the one whose midpoint is
 * closest to the reported midpoint — keeps two adjacent bugs on the same
 * file from stealing each other's hits.
 */
export function matchFindings(
  reported: Finding[],
  gt: GroundTruth,
): FindingMatch[] {
  const slack = gt.match_policy.line_slack;

  return reported.map((r): FindingMatch => {
    const candidates = gt.findings.filter((g) =>
      isCandidate(r, g, slack),
    );
    if (candidates.length === 0) {
      return { reported: r, matchedId: null, matchKind: "none" };
    }
    const best = pickClosest(r, candidates);
    return {
      reported: r,
      matchedId: best.id,
      matchKind: best.must_detect ? "must" : "bonus",
      expectedSeverity: best.severity,
    };
  });
}

function isCandidate(
  r: Finding,
  g: GroundTruthEntry,
  slack: number,
): boolean {
  if (r.file !== g.file) return false;
  const gStart = g.line_start - slack;
  const gEnd = g.line_end + slack;
  if (r.line_end < gStart || r.line_start > gEnd) return false;
  return matchesCategory(r.rule_id, g);
}

function matchesCategory(ruleId: string, g: GroundTruthEntry): boolean {
  const id = normalize(ruleId);
  if (normalize(g.category) === id) return true;
  for (const a of g.aliases) {
    if (normalize(a) === id) return true;
  }
  return false;
}

/**
 * Normalize a rule_id / category string for comparison: lowercase, and treat
 * `_` / `-` / spaces as equivalent. Scanners frequently disagree on
 * separators (`sql_injection` vs `sql-injection`) so this kills that whole
 * class of accidental misses.
 */
function normalize(s: string): string {
  return s.toLowerCase().replace(/[\s_-]+/g, "-");
}

function pickClosest(
  r: Finding,
  candidates: GroundTruthEntry[],
): GroundTruthEntry {
  const rMid = (r.line_start + r.line_end) / 2;
  let best = candidates[0]!;
  let bestDist = Math.abs(midpoint(best) - rMid);
  for (let i = 1; i < candidates.length; i++) {
    const c = candidates[i]!;
    const d = Math.abs(midpoint(c) - rMid);
    if (d < bestDist) {
      best = c;
      bestDist = d;
    }
  }
  return best;
}

function midpoint(g: GroundTruthEntry): number {
  return (g.line_start + g.line_end) / 2;
}
