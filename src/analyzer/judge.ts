import { z } from "zod";
import type { Finding, Severity } from "../types.js";

/**
 * LLM-as-judge second-pass review.
 *
 * Critical findings from the first pass are re-examined here with the FULL file
 * content as context (rather than the original chunk). The judge can:
 *   - confirm   → keep the finding as-is
 *   - reject    → drop the finding (typical: false positive in test/example code,
 *                 input is gated upstream, dead code path, etc.)
 *   - downgrade → keep but reduce severity to `new_severity`
 *
 * Purpose: filter the long tail of plausible-sounding-but-not-actually-exploitable
 * critical findings that come out of the first pass.
 */

export const JUDGE_SYSTEM_PROMPT = `You are a SENIOR security reviewer doing an independent re-check of a finding flagged as CRITICAL by an upstream analyzer.

You receive the WHOLE file (the first-pass analyzer only saw a fragment). Your job is to decide if this critical finding is REAL and exploitable, or a false positive.

Decision rules:
- "confirm"   → the issue is real, exploitable, and the severity is appropriate.
- "reject"   → the code is not exploitable in this codebase. Common reasons:
                * it is inside #[cfg(test)] / tests / examples / benches / build.rs
                * input is validated / typed / bounded before reaching this line
                * the surrounding call sites only pass trusted constants
                * the "vulnerability" requires a precondition that is statically impossible here
- "downgrade" → real issue, but "critical" is too strong (e.g. requires admin context,
                limited blast radius, or only affects availability not integrity).
                You MUST provide a more accurate "new_severity".

Be strict. Default to "reject" if you cannot articulate a concrete exploitation path.
Do NOT confirm based on stylistic concerns ("could panic in theory", "should use checked_*").
Stylistic-only findings → reject.

Output STRICTLY this JSON object and nothing else:
{
  "verdict": "confirm" | "reject" | "downgrade",
  "new_severity": "critical" | "high" | "medium" | "low" | "info",
  "reason": "one-sentence justification grounded in the file",
  "confidence": 0.0
}

"new_severity" is required for "downgrade" and ignored otherwise (set it to the original severity in that case).`;

export function buildJudgePrompt(finding: Finding, fileContent: string): string {
  return [
    `Finding to review:`,
    `  rule_id:    ${finding.rule_id}`,
    `  severity:   ${finding.severity}`,
    `  file:       ${finding.file}`,
    `  lines:      ${finding.line_start}-${finding.line_end}`,
    `  summary:    ${finding.summary}`,
    `  confidence: ${finding.confidence}`,
    ``,
    `Evidence reported by first-pass analyzer:`,
    "```rust",
    finding.evidence,
    "```",
    ``,
    `Full file content (use this as the ground truth for exploitability):`,
    "```rust",
    fileContent,
    "```",
    ``,
    `Return only the JSON object. No prose.`,
  ].join("\n");
}

export const JudgeResponseSchema = z.object({
  verdict: z.enum(["confirm", "reject", "downgrade"]),
  new_severity: z.enum(["critical", "high", "medium", "low", "info"]).optional(),
  reason: z.string(),
  confidence: z.number().min(0).max(1),
});

export type JudgeResponse = z.infer<typeof JudgeResponseSchema>;

export type JudgeDecision =
  | { kind: "keep" }
  | { kind: "drop"; reason: string }
  | { kind: "downgrade"; newSeverity: Severity; reason: string };

export function safeParseJudge(text: string): JudgeResponse | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < 0 || end <= start) return null;
  try {
    const obj = JSON.parse(text.slice(start, end + 1));
    const r = JudgeResponseSchema.safeParse(obj);
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

/**
 * Translate a judge response into a concrete decision on the original finding.
 * If the model returns an incoherent answer (e.g. "downgrade" with no
 * new_severity, or "downgrade" to the same severity) we default to "keep" —
 * better to surface a possibly-real critical than to silently drop it on a
 * malformed response.
 */
export function decideFromJudge(original: Finding, j: JudgeResponse): JudgeDecision {
  if (j.verdict === "reject") return { kind: "drop", reason: j.reason };
  if (j.verdict === "downgrade") {
    if (!j.new_severity || j.new_severity === original.severity) {
      return { kind: "keep" };
    }
    return { kind: "downgrade", newSeverity: j.new_severity, reason: j.reason };
  }
  return { kind: "keep" };
}
