import chalk from "chalk";
import type { Finding, Severity } from "../types.js";

const SEV_COLOR: Record<Severity, (s: string) => string> = {
  critical: chalk.bgRed.white.bold,
  high: chalk.red.bold,
  medium: chalk.yellow,
  low: chalk.blue,
  info: chalk.gray,
};

const ORDER: Record<Severity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

function byPriority(a: Finding, b: Finding): number {
  return ORDER[a.severity] - ORDER[b.severity] || b.confidence - a.confidence;
}

export function renderTerminal(findings: Finding[]): string {
  if (findings.length === 0) return chalk.green("No findings.");

  const byCrate = new Map<string, Finding[]>();
  for (const f of findings) {
    const key = f.crate ?? "(unknown crate)";
    let list = byCrate.get(key);
    if (!list) {
      list = [];
      byCrate.set(key, list);
    }
    list.push(f);
  }

  const lines: string[] = [];
  for (const [crate, list] of byCrate) {
    lines.push("", chalk.bold.underline(`[${crate}]  ${list.length} finding(s)`));
    const ordered = [...list].sort(byPriority);
    for (const f of ordered) {
      lines.push(
        `  ${SEV_COLOR[f.severity](f.severity.toUpperCase().padEnd(8))} ${chalk.cyan(f.rule_id)}  ${chalk.dim(`${f.file}:${f.line_start}`)}`,
        `    ${f.summary}`,
        `    ${chalk.dim("fix:")} ${f.fix_suggestion}`,
      );
    }
  }
  lines.push(
    "",
    chalk.bold(`Total: ${findings.length} finding(s) across ${byCrate.size} crate(s)`),
  );
  return lines.join("\n");
}
