#!/usr/bin/env node
import { Command } from "commander";
import dotenv from "dotenv";
import { scan } from "./commands/scan.js";
import { evaluate } from "./commands/evaluate.js";
import { listProviders } from "./config/index.js";
import { SCAN_MODES, type ScanMode } from "./types.js";

dotenv.config();

const program = new Command();

program
  .name("ai-bug-scanner")
  .description("AI-powered security scanner (currently focused on Rust)")
  .version("0.0.1");

program
  .command("scan")
  .description("Scan a Rust project for security issues")
  .argument("<dir>", "project directory to scan")
  .option(
    "-p, --provider <name>",
    `LLM provider (one of: ${listProviders().join(", ")})`,
    process.env.AI_BUG_SCANNER_PROVIDER ?? "kimi",
  )
  .option("-o, --output <format>", "terminal | json", "terminal")
  .option("--max-files <n>", "max files to analyze", (v) => parseInt(v, 10))
  .option("--concurrency <n>", "parallel LLM calls", (v) => parseInt(v, 10), 4)
  .option(
    "--max-retries <n>",
    "retry attempts per chunk on rate-limit / 5xx / network errors",
    (v) => parseInt(v, 10),
    5,
  )
  .option(
    "--crate <name>",
    "limit scan to specific crate(s); pass multiple times to scan several",
    (v: string, prev: string[]) => [...prev, v],
    [] as string[],
  )
  .option(
    "--mode <mode>",
    `scan focus: ${SCAN_MODES.join(" | ")} — safety = memory safety / casts / injection / crypto; logic = logic bugs, DoS, concurrency design, implementation defects; panic = every reachable crash path (unwrap on runtime-fallible values, OOB index/slice, divide-by-zero, lock poisoning, Drop / FFI panics, stack overflow)`,
    (v: string): ScanMode => {
      if (!(SCAN_MODES as readonly string[]).includes(v)) {
        throw new Error(
          `Invalid --mode: ${v}. Expected one of: ${SCAN_MODES.join(", ")}.`,
        );
      }
      return v as ScanMode;
    },
    "safety" as ScanMode,
  )
  .option(
    "--unit <unit>",
    "chunking unit sent to the LLM: ast-function (tree-sitter, recommended) | function (regex windowed) | file (whole file)",
    (v: string): "function" | "file" | "ast-function" => {
      if (v !== "function" && v !== "file" && v !== "ast-function") {
        throw new Error(
          `Invalid --unit: ${v}. Expected "ast-function", "function", or "file".`,
        );
      }
      return v;
    },
    "ast-function" as "function" | "file" | "ast-function",
  )
  .option(
    "--no-judge",
    "skip the LLM-as-judge second pass that re-checks critical findings",
  )
  .option(
    "--report <path>",
    "write the full-run report to <path>; format is inferred from the extension (.html | .json), default: ./<project>-<provider>-<model>.html",
  )
  .option("--no-report", "do not write a report file")
  .option(
    "--cache-dir <dir>",
    "directory to store resumable scan cache (per provider+model+project)",
    "./.ai-bug-scanner-cache",
  )
  .option(
    "--no-resume",
    "ignore any existing cache and re-run every chunk (also disables writing the cache)",
  )
  .option("--dry-run", "skip LLM calls; print prefilter results only", false)
  .action(scan);

program
  .command("evaluate")
  .description("Score a scan report against a ground-truth YAML")
  .argument("<report>", "scan report JSON (from `scan --report ...json` or `scan --output json`)")
  .requiredOption(
    "-g, --ground-truth <path>",
    "path to ground-truth.yaml describing expected findings",
  )
  .option("-o, --output <format>", "text | json", "text")
  .option(
    "--min-recall <n>",
    "exit non-zero unless recall >= n (0..1)",
    (v) => parseFloat(v),
  )
  .option(
    "--min-precision <n>",
    "exit non-zero unless precision >= n (0..1)",
    (v) => parseFloat(v),
  )
  .action(evaluate);

program.parseAsync(process.argv).catch((err) => {
  process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
