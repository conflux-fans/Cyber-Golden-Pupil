import type { Finding } from "../types.js";
import type { RunStats } from "../analyzer/runner.js";

/**
 * Full-fidelity scan report written to disk after each run.
 *
 * This is the persistent record of a scan. It is distinct from the stdout
 * reporters (`terminal.ts`, `json.ts`) which exist for live human/pipe
 * consumption — those only carry findings.
 */

export interface ReportArgs {
  startedAt: Date;
  finishedAt: Date;
  project: {
    name: string;
    path: string;
    isWorkspace: boolean;
    crates: string[];
  };
  fileCount: number;
  lineCount: number;
  provider: {
    name: string;
    model: string;
    baseUrl: string;
    protocol: string;
  };
  config: {
    unit: string;
    concurrency: number;
    maxRetries: number;
    judge: boolean;
  };
  stats: RunStats;
  findings: Finding[];
}

export function buildReport(args: ReportArgs): string {
  const payload = {
    scan: {
      started_at: args.startedAt.toISOString(),
      finished_at: args.finishedAt.toISOString(),
      duration_ms: args.finishedAt.getTime() - args.startedAt.getTime(),
    },
    project: {
      name: args.project.name,
      path: args.project.path,
      is_workspace: args.project.isWorkspace,
      crates: args.project.crates,
      file_count: args.fileCount,
      line_count: args.lineCount,
    },
    model: {
      provider: args.provider.name,
      model: args.provider.model,
      base_url: args.provider.baseUrl,
      protocol: args.provider.protocol,
    },
    config: args.config,
    tokens: {
      input: args.stats.inputTokens,
      output: args.stats.outputTokens,
      total: args.stats.inputTokens + args.stats.outputTokens,
      analyze_calls: args.stats.analyzeCalls,
      judge_calls: args.stats.judgeCalls,
    },
    findings: args.findings,
  };
  return JSON.stringify(payload, null, 2);
}

/**
 * Count source lines of code across the scanned files. We use a "non-empty
 * trailing line" convention: a file ending in "\n" doesn't count the empty
 * tail; a file without a final newline counts its last partial line.
 */
export function countLines(content: string): number {
  if (content.length === 0) return 0;
  const parts = content.split("\n").length;
  return content.endsWith("\n") ? parts - 1 : parts;
}

/**
 * Default report filename, composed of the scan project name and the LLM
 * identifier so repeat scans against the same project under different models
 * (or the same model on different projects) don't overwrite each other.
 *
 * Each path component is sanitized: anything that would be a path separator,
 * shell-troublesome character, whitespace, or control byte becomes `-`.
 * Leading dots are stripped so we never accidentally produce a hidden file.
 */
export function defaultReportFilename(
  projectName: string,
  providerName: string,
  model: string,
): string {
  const parts = [projectName, providerName, model].map(sanitizeForFilename);
  return `${parts.join("-")}.html`;
}

function sanitizeForFilename(s: string): string {
  const cleaned = s.replace(/[\/\\:*?"<>|\s\x00-\x1f]+/g, "-");
  const trimmed = cleaned.replace(/^[-.]+|[-.]+$/g, "");
  return trimmed || "scan";
}
