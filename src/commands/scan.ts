import chalk from "chalk";
import ora from "ora";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadConfig } from "../config/index.js";
import { loadProject } from "../scanner/project.js";
import { walkCrates } from "../scanner/walker.js";
import { prefilter, type ChunkingUnit } from "../scanner/prefilter.js";
import { analyze } from "../analyzer/runner.js";
import type { ScanMode } from "../types.js";
import { renderTerminal } from "../reporter/terminal.js";
import { renderJson } from "../reporter/json.js";
import { buildReport, countLines, defaultReportFilename } from "../reporter/report.js";
import { renderHtmlReport } from "../reporter/html.js";
import { createClient } from "../providers/factory.js";
import { ScanCache, type ScanCacheKey } from "../analyzer/cache.js";

interface ScanOptions {
  provider: string;
  output: "terminal" | "json";
  maxFiles?: number;
  concurrency: number;
  maxRetries: number;
  judge: boolean;
  dryRun: boolean;
  crate: string[];
  unit: ChunkingUnit;
  mode: ScanMode;
  report?: string | false;
  cacheDir: string;
  /** Commander's `--no-resume` produces `resume: false`; default is `true`. */
  resume: boolean;
}

export async function scan(dir: string, opts: ScanOptions): Promise<void> {
  const startedAt = new Date();
  const spin = ora("Detecting project...").start();
  const project = await loadProject(dir);

  let crates = project.crates;
  if (opts.crate.length > 0) {
    const wanted = new Set(opts.crate);
    crates = crates.filter((c) => wanted.has(c.name));
    if (crates.length === 0) {
      spin.fail(
        `No crates matched filter ${chalk.cyan(opts.crate.join(", "))}. ` +
          `Available: ${project.crates.map((c) => c.name).join(", ")}`,
      );
      return;
    }
  }

  const projectLabel = project.isWorkspace
    ? `workspace ${chalk.cyan(project.projectName)} (${crates.length}/${project.crates.length} crate(s): ${crates.map((c) => c.name).join(", ")})`
    : `crate ${chalk.cyan(project.projectName)}`;
  spin.succeed(`Project: ${projectLabel}`);

  spin.start("Walking source files...");
  const files = await walkCrates(project.rootDir, crates, opts.maxFiles);
  let lineCount = 0;
  for (const f of files) lineCount += countLines(f.content);
  spin.succeed(
    `Found ${chalk.cyan(files.length)} .rs file(s), ${chalk.cyan(lineCount)} line(s) of code`,
  );
  if (files.length === 0) {
    process.stderr.write("No Rust source files found.\n");
    return;
  }

  spin.start(`Pre-filtering risky regions (mode=${opts.mode}, unit=${opts.unit})...`);
  const chunks = prefilter(files, opts.unit, opts.mode);
  spin.succeed(
    `Pre-filter produced ${chalk.cyan(chunks.length)} candidate chunk(s) (mode=${opts.mode}, unit=${opts.unit})`,
  );

  if (opts.dryRun) {
    spin.info("Dry-run: skipping LLM analysis (no report file written)");
    if (opts.output === "json") {
      process.stdout.write(
        JSON.stringify(
          chunks.map((c) => ({
            crate: c.file.crate,
            file: c.file.relPath,
            startLine: c.startLine,
            endLine: c.endLine,
            hints: c.hints,
          })),
          null,
          2,
        ) + "\n",
      );
    } else {
      for (const c of chunks) {
        process.stdout.write(
          `[${c.file.crate}] ${c.file.relPath}:${c.startLine}-${c.endLine}  hints=[${c.hints.join(",")}]\n`,
        );
      }
    }
    return;
  }

  const cfg = loadConfig(opts.provider);
  const label = `${cfg.providerName}/${cfg.model}`;

  let cache: ScanCache | undefined;
  if (opts.resume) {
    const cacheKey: ScanCacheKey = {
      projectPath: project.rootDir,
      provider: cfg.providerName,
      model: cfg.model,
      unit: opts.unit,
      mode: opts.mode,
      judge: opts.judge,
      crates: crates.map((c) => c.name),
    };
    const cachePath = ScanCache.computePath(opts.cacheDir, project.projectName, cacheKey);
    cache = new ScanCache(cachePath);
    spin.start("Loading scan cache...");
    const hits = await cache.load();
    await cache.openForWrite(cacheKey);
    if (hits.chunkHits + hits.judgeHits > 0) {
      spin.succeed(
        `Resuming from cache ${chalk.cyan(cachePath)}: ` +
          `${chalk.cyan(hits.chunkHits)} chunk result(s), ` +
          `${chalk.cyan(hits.judgeHits)} judgement(s) cached`,
      );
    } else {
      spin.succeed(`Cache initialized at ${chalk.cyan(cachePath)}`);
    }
  }

  spin.start(formatProgress(label, 0, chunks.length));
  const client = createClient(cfg);
  let findings: Awaited<ReturnType<typeof analyze>>["findings"];
  let stats: Awaited<ReturnType<typeof analyze>>["stats"];
  try {
    ({ findings, stats } = await analyze(chunks, client, {
      concurrency: opts.concurrency,
      maxRetries: opts.maxRetries,
      judge: opts.judge,
      mode: opts.mode,
      cache,
      onProgress: (done, total) => {
        spin.text = formatProgress(label, done, total);
      },
      onJudgeStart: (n) => {
        spin.text = `Judging ${chalk.cyan(n)} critical finding(s) with ${label}...`;
      },
      onJudgeProgress: (done, total) => {
        spin.text = formatJudgeProgress(label, done, total);
      },
    }));
  } finally {
    await cache?.close();
  }
  const cacheNote =
    cache && stats.chunkCacheHits + stats.judgeCacheHits > 0
      ? ` [cached: ${stats.chunkCacheHits} chunk + ${stats.judgeCacheHits} judge]`
      : "";
  spin.succeed(
    `Analysis complete. ${chalk.cyan(findings.length)} finding(s). ` +
      `Tokens: ${chalk.cyan(stats.inputTokens)} in / ${chalk.cyan(stats.outputTokens)} out ` +
      `(${stats.analyzeCalls} analyze + ${stats.judgeCalls} judge call(s))${cacheNote}.`,
  );

  if (opts.output === "json") process.stdout.write(renderJson(findings) + "\n");
  else process.stdout.write(renderTerminal(findings) + "\n");

  if (opts.report !== false) {
    const filename =
      typeof opts.report === "string" && opts.report.length > 0
        ? opts.report
        : defaultReportFilename(project.projectName, cfg.providerName, cfg.model);
    const reportPath = resolve(filename);
    const reportArgs = {
      startedAt,
      finishedAt: new Date(),
      project: {
        name: project.projectName,
        path: project.rootDir,
        isWorkspace: project.isWorkspace,
        crates: crates.map((c) => c.name),
      },
      fileCount: files.length,
      lineCount,
      provider: {
        name: cfg.providerName,
        model: cfg.model,
        baseUrl: cfg.baseUrl,
        protocol: cfg.protocol,
      },
      config: {
        unit: opts.unit,
        mode: opts.mode,
        concurrency: opts.concurrency,
        maxRetries: opts.maxRetries,
        judge: opts.judge,
      },
      stats,
      findings,
    };
    const body =
      reportFormatFromPath(filename) === "json"
        ? buildReport(reportArgs)
        : renderHtmlReport(reportArgs);
    await writeFile(reportPath, body.endsWith("\n") ? body : body + "\n", "utf8");
    process.stderr.write(`Report written to ${reportPath}\n`);
  }
}

/**
 * Pick the report format from the file extension. HTML is the default for
 * anything that isn't an explicit `.json`, so `--report ./foo` (no extension)
 * still produces a valid HTML report.
 */
function reportFormatFromPath(path: string): "html" | "json" {
  return path.toLowerCase().endsWith(".json") ? "json" : "html";
}

function formatProgress(label: string, done: number, total: number): string {
  const pct = total === 0 ? 100 : Math.floor((done / total) * 100);
  return `Analyzing with ${label}  ${chalk.cyan(`${done}/${total}`)} ${chalk.bold(`(${pct}%)`)}`;
}

function formatJudgeProgress(label: string, done: number, total: number): string {
  const pct = total === 0 ? 100 : Math.floor((done / total) * 100);
  return `Judging critical findings with ${label}  ${chalk.cyan(`${done}/${total}`)} ${chalk.bold(`(${pct}%)`)}`;
}
