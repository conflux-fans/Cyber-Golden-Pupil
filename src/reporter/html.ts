import type { ReportArgs } from "./report.js";
import type { Finding } from "../types.js";

/**
 * Render a full scan report as a self-contained HTML document.
 *
 * Self-contained = inline CSS, no external assets, no JS. The file can be
 * emailed, archived, or opened in any browser without network access.
 *
 * All interpolated strings (file paths, summaries, evidence, fix suggestions)
 * go through `esc()` because evidence is verbatim source code from the scanned
 * project — and could contain `<script>` or other markup-meaningful text.
 */

export function renderHtmlReport(args: ReportArgs): string {
  const durationSec = (
    (args.finishedAt.getTime() - args.startedAt.getTime()) / 1000
  ).toFixed(2);

  const meta: Array<[string, string]> = [
    ["Project", esc(args.project.name)],
    ["Path", `<code>${esc(args.project.path)}</code>`],
    [args.project.isWorkspace ? "Crates" : "Crate", esc(args.project.crates.join(", "))],
    ["Files scanned", String(args.fileCount)],
    ["Lines of code", String(args.lineCount)],
    ["Provider / model", `<code>${esc(args.provider.name)} / ${esc(args.provider.model)}</code>`],
    ["API base URL", `<code>${esc(args.provider.baseUrl)}</code>`],
    ["Protocol", esc(args.provider.protocol)],
    ["Chunking unit", esc(args.config.unit)],
    ["Concurrency", String(args.config.concurrency)],
    ["Max retries", String(args.config.maxRetries)],
    ["Judge pass", args.config.judge ? "enabled" : "disabled"],
    ["Started at", args.startedAt.toISOString()],
    ["Duration", `${durationSec}s`],
    ["Input tokens", String(args.stats.inputTokens)],
    ["Output tokens", String(args.stats.outputTokens)],
    ["Total tokens", String(args.stats.inputTokens + args.stats.outputTokens)],
    ["LLM calls", `${args.stats.analyzeCalls} analyze + ${args.stats.judgeCalls} judge`],
  ];

  const metaHtml = meta
    .map(([k, v]) => `    <div><dt>${esc(k)}</dt><dd>${v}</dd></div>`)
    .join("\n");

  const findingsHtml =
    args.findings.length === 0
      ? `<p class="empty">No findings.</p>`
      : `<table class="findings">
  <thead>
    <tr><th>Severity</th><th>Rule</th><th>Location</th><th>Summary</th><th>Confidence</th></tr>
  </thead>
  <tbody>
${args.findings.map(renderRow).join("\n")}
  </tbody>
</table>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>AI Bug Scanner Report — ${esc(args.project.name)}</title>
<style>${CSS}</style>
</head>
<body>
<h1>AI Bug Scanner Report</h1>
<p class="subtitle">Project <strong>${esc(args.project.name)}</strong> — <strong>${args.findings.length}</strong> finding(s)</p>

<h2>Run info</h2>
<dl class="meta">
${metaHtml}
</dl>

<h2>Findings</h2>
${findingsHtml}
</body>
</html>
`;
}

function renderRow(f: Finding): string {
  const cratePrefix = f.crate ? `${esc(f.crate)} · ` : "";
  const lineRange =
    f.line_end !== f.line_start ? `${f.line_start}-${f.line_end}` : String(f.line_start);
  const loc = `${cratePrefix}${esc(f.file)}:${lineRange}`;
  const cwe = f.cwe ? `<br><small>${esc(f.cwe)}</small>` : "";
  return `    <tr>
      <td><span class="sev sev-${esc(f.severity)}">${esc(f.severity)}</span></td>
      <td><code>${esc(f.rule_id)}</code>${cwe}</td>
      <td><code>${loc}</code></td>
      <td>${esc(f.summary)}
        <details>
          <summary>Evidence &amp; fix</summary>
          <pre>${esc(f.evidence)}</pre>
          <p class="fix"><strong>Fix:</strong> ${esc(f.fix_suggestion)}</p>
        </details>
      </td>
      <td class="conf">${f.confidence.toFixed(2)}</td>
    </tr>`;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const CSS = `
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; max-width: 1150px; margin: 2em auto; padding: 0 1em; color: #222; line-height: 1.4; }
  h1 { margin-bottom: 0.1em; }
  h2 { margin-top: 2em; border-bottom: 1px solid #ddd; padding-bottom: 0.3em; }
  .subtitle { color: #555; margin-top: 0; }
  dl.meta { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 0.7em 1.2em; background: #f7f7f8; padding: 1em 1.2em; border-radius: 6px; margin: 0 0 1.5em; }
  dl.meta dt { font-size: 0.72em; color: #666; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 2px; }
  dl.meta dd { margin: 0; font-weight: 500; word-break: break-all; }
  table.findings { width: 100%; border-collapse: collapse; font-size: 0.94em; }
  table.findings th { text-align: left; background: #f0f0f0; padding: 0.6em 0.75em; border-bottom: 2px solid #ccc; font-size: 0.78em; text-transform: uppercase; letter-spacing: 0.3px; color: #444; }
  table.findings td { padding: 0.7em 0.75em; border-bottom: 1px solid #eee; vertical-align: top; }
  td.conf { font-variant-numeric: tabular-nums; color: #555; }
  .sev { display: inline-block; padding: 3px 9px; border-radius: 3px; font-size: 0.72em; font-weight: 700; text-transform: uppercase; letter-spacing: 0.6px; color: white; white-space: nowrap; }
  .sev-critical { background: #7c1010; }
  .sev-high     { background: #c92f2f; }
  .sev-medium   { background: #d97706; }
  .sev-low      { background: #2563eb; }
  .sev-info     { background: #6b7280; }
  code { font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; font-size: 0.9em; }
  pre { background: #1e1e1e; color: #f5f5f5; padding: 0.8em; border-radius: 4px; overflow-x: auto; font-size: 0.82em; margin: 0.5em 0; }
  details { margin-top: 0.5em; }
  summary { cursor: pointer; color: #555; font-size: 0.85em; }
  .fix { margin: 0.5em 0 0; font-size: 0.92em; }
  small { color: #777; font-size: 0.78em; }
  .empty { color: #888; font-style: italic; padding: 1em 0; }
`;
