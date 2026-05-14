import { readFile } from "node:fs/promises";
import chalk from "chalk";
import type { Finding } from "../types.js";
import { loadGroundTruth } from "../evaluator/ground-truth.js";
import { matchFindings } from "../evaluator/matcher.js";
import { summarize } from "../evaluator/metrics.js";
import { renderEvalJson, renderEvalText } from "../evaluator/render.js";

interface EvaluateOptions {
  groundTruth: string;
  output: "text" | "json";
  /** Exit non-zero unless recall ≥ threshold. */
  minRecall?: number;
  /** Exit non-zero unless precision ≥ threshold. */
  minPrecision?: number;
}

export async function evaluate(
  reportPath: string,
  opts: EvaluateOptions,
): Promise<void> {
  const [gt, findings] = await Promise.all([
    loadGroundTruth(opts.groundTruth),
    loadFindings(reportPath),
  ]);

  const matches = matchFindings(findings, gt);
  const summary = summarize(matches, gt);

  if (opts.output === "json") {
    process.stdout.write(renderEvalJson(summary));
  } else {
    process.stdout.write(renderEvalText(summary, gt) + "\n");
  }

  // Threshold gating for CI. Both thresholds are optional; if neither is set
  // we always exit 0 regardless of metrics.
  const failures: string[] = [];
  if (opts.minRecall !== undefined && summary.recall < opts.minRecall) {
    failures.push(
      `recall ${(summary.recall * 100).toFixed(1)}% < min ${(opts.minRecall * 100).toFixed(1)}%`,
    );
  }
  if (opts.minPrecision !== undefined && summary.precision < opts.minPrecision) {
    failures.push(
      `precision ${(summary.precision * 100).toFixed(1)}% < min ${(opts.minPrecision * 100).toFixed(1)}%`,
    );
  }
  if (failures.length > 0) {
    process.stderr.write(
      chalk.red(`\nThreshold check failed: ${failures.join("; ")}\n`),
    );
    process.exit(1);
  }
}

/**
 * Load a `Finding[]` from either:
 *   - the full-run report shape `{ findings: [...], scan: {...}, ... }`
 *     written by `scan --report`, OR
 *   - the stdout JSON shape `{ findings: [...], generated_at }` from
 *     `scan --output json`, OR
 *   - a bare array `[...]` for ad-hoc inputs.
 */
async function loadFindings(path: string): Promise<Finding[]> {
  const raw = await readFile(path, "utf8");
  const doc = JSON.parse(raw) as unknown;
  if (Array.isArray(doc)) return doc as Finding[];
  if (doc && typeof doc === "object" && "findings" in doc) {
    const arr = (doc as { findings: unknown }).findings;
    if (Array.isArray(arr)) return arr as Finding[];
  }
  throw new Error(
    `Cannot find a findings array in ${path}. Expected one of: ` +
      `{findings: [...]} or a bare [...] array.`,
  );
}
