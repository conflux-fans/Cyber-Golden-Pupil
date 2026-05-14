import chalk from "chalk";
import type { Finding } from "../types.js";
import type { EvalSummary, GroundTruth } from "./types.js";

export function renderEvalText(
  summary: EvalSummary,
  gt: GroundTruth,
): string {
  const lines: string[] = [];
  lines.push(chalk.bold(`Evaluation: ${summary.target}`));
  lines.push(
    `  Ground truth: ${summary.must.total} must-detect, ${summary.bonus.total} bonus`,
  );
  lines.push(`  Reported:     ${summary.reported.total} findings`);
  lines.push("");
  lines.push(
    `  Recall (must-detect):  ${summary.must.hit}/${summary.must.total} ` +
      `(${pct(summary.recall)})`,
  );
  lines.push(
    `  Precision:             ${summary.reported.truePositives}/${summary.reported.total} ` +
      `(${pct(summary.precision)})`,
  );
  if (summary.bonus.total > 0) {
    lines.push(
      `  Bonus hits:            ${summary.bonus.hit}/${summary.bonus.total}`,
    );
  }

  if (summary.must.missed.length > 0) {
    lines.push("");
    lines.push(chalk.yellow(`  Missed (${summary.must.missed.length}):`));
    for (const m of summary.must.missed) {
      lines.push(
        `    - ${m.id}  ${m.file}:${m.line_start}-${m.line_end}  ` +
          `${m.category}  ${m.severity}`,
      );
    }
  }

  if (summary.reported.falsePositives.length > 0) {
    lines.push("");
    lines.push(
      chalk.yellow(
        `  False positives (${summary.reported.falsePositives.length}):`,
      ),
    );
    for (const fp of summary.reported.falsePositives) {
      lines.push(
        `    - ${fp.file}:${fp.line_start}-${fp.line_end}  ` +
          `rule=${fp.rule_id}  severity=${fp.severity}`,
      );
    }
  }

  if (hasAnyHits(summary)) {
    lines.push("");
    lines.push(renderConfusionMatrix(summary, gt));
  }

  return lines.join("\n");
}

function hasAnyHits(summary: EvalSummary): boolean {
  for (const row of summary.severityConfusion) {
    for (const v of row) if (v > 0) return true;
  }
  return false;
}

function renderConfusionMatrix(
  summary: EvalSummary,
  gt: GroundTruth,
): string {
  const order = gt.match_policy.severity_order;
  const colWidth = Math.max(8, ...order.map((s) => s.length + 2));
  const header =
    "  Severity confusion (rows=expected, cols=reported):\n" +
    "    " +
    " ".repeat(colWidth) +
    order.map((s) => s.padStart(colWidth)).join("");
  const rows = order.map((s, i) => {
    const cells = summary.severityConfusion[i]!.map((v) =>
      String(v).padStart(colWidth),
    );
    return "    " + s.padEnd(colWidth) + cells.join("");
  });
  return [header, ...rows].join("\n");
}

function pct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

/**
 * Machine-readable summary for CI integration. Mirrors `EvalSummary` but
 * with `falsePositives` flattened to identifying fields only.
 */
export function renderEvalJson(summary: EvalSummary): string {
  return (
    JSON.stringify(
      {
        target: summary.target,
        recall: summary.recall,
        precision: summary.precision,
        must: {
          total: summary.must.total,
          hit: summary.must.hit,
          missed: summary.must.missed.map((m) => ({
            id: m.id,
            file: m.file,
            line_start: m.line_start,
            line_end: m.line_end,
            category: m.category,
            severity: m.severity,
          })),
        },
        bonus: summary.bonus,
        reported: {
          total: summary.reported.total,
          true_positives: summary.reported.truePositives,
          false_positives: summary.reported.falsePositives.map(briefFinding),
        },
        severity_confusion: summary.severityConfusion,
      },
      null,
      2,
    ) + "\n"
  );
}

function briefFinding(f: Finding): Record<string, unknown> {
  return {
    file: f.file,
    line_start: f.line_start,
    line_end: f.line_end,
    rule_id: f.rule_id,
    severity: f.severity,
    summary: f.summary,
  };
}
