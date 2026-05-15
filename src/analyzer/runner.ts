import pLimit from "p-limit";
import type { Chunk, Finding, Severity } from "../types.js";
import type { LLMClient, LLMRequest, LLMResponse } from "../providers/base.js";
import { SYSTEM_PROMPT, buildUserPrompt } from "./prompts.js";
import { AnalysisResponseSchema } from "./schema.js";
import {
  JUDGE_SYSTEM_PROMPT,
  buildJudgePrompt,
  decideFromJudge,
  safeParseJudge,
  type JudgeDecision,
} from "./judge.js";
import { withRetry } from "../utils/retry.js";
import {
  type ScanCache,
  chunkCacheKey,
  findingCacheKey,
} from "./cache.js";

interface RunOpts {
  concurrency: number;
  maxRetries?: number;
  /** Run an LLM-as-judge second pass on critical findings. Default: true. */
  judge?: boolean;
  /** Optional resumable cache. When provided, completed chunks/judgements are
   *  persisted as they finish and re-used on subsequent runs. */
  cache?: ScanCache;
  onProgress?: (completed: number, total: number) => void;
  onJudgeStart?: (count: number) => void;
  onJudgeProgress?: (completed: number, total: number) => void;
}

export interface RunStats {
  inputTokens: number;
  outputTokens: number;
  /** Successful first-pass LLM calls (one per chunk that completed without exhausting retries). */
  analyzeCalls: number;
  /** Successful judge-pass LLM calls (one per critical finding the judge reviewed). */
  judgeCalls: number;
  /** Chunks served from cache instead of issuing an LLM call (subset of analyzeCalls). */
  chunkCacheHits: number;
  /** Judgements served from cache instead of issuing an LLM call (subset of judgeCalls). */
  judgeCacheHits: number;
}

export interface RunResult {
  findings: Finding[];
  stats: RunStats;
}

// Backoff bounds for retryable LLM errors. Initial=2s covers most short rate-limit
// windows; max=60s avoids pathological waits if a vendor returns a huge Retry-After.
const INITIAL_DELAY_MS = 2_000;
const MAX_DELAY_MS = 60_000;

// After this many successive successful calls under a reduced concurrency, we
// raise the cap by one. Slow recovery keeps us from immediately tripping the
// rate limit again.
const RECOVERY_THRESHOLD = 10;

export async function analyze(
  chunks: Chunk[],
  client: LLMClient,
  opts: RunOpts,
): Promise<RunResult> {
  const limit = pLimit(opts.concurrency);
  const initialConcurrency = opts.concurrency;
  const maxRetries = opts.maxRetries ?? 5;
  let successesSinceShrink = 0;
  const stats: RunStats = {
    inputTokens: 0,
    outputTokens: 0,
    analyzeCalls: 0,
    judgeCalls: 0,
    chunkCacheHits: 0,
    judgeCacheHits: 0,
  };

  const shrink = (reason: string): void => {
    if (limit.concurrency <= 1) return;
    const next = Math.max(1, Math.floor(limit.concurrency / 2));
    process.stderr.write(
      `[throttle] ${reason}: concurrency ${limit.concurrency} → ${next}\n`,
    );
    limit.concurrency = next;
    successesSinceShrink = 0;
  };

  const recordSuccess = (): void => {
    if (limit.concurrency >= initialConcurrency) return;
    successesSinceShrink++;
    if (successesSinceShrink >= RECOVERY_THRESHOLD) {
      const next = Math.min(initialConcurrency, limit.concurrency + 1);
      process.stderr.write(
        `[throttle] recovering: concurrency ${limit.concurrency} → ${next}\n`,
      );
      limit.concurrency = next;
      successesSinceShrink = 0;
    }
  };

  // Single LLM call with retry + shared throttle state. Both passes go through
  // this so a 429 in one phase ripples through to the other.
  //
  // Unlike the previous version, this does NOT update RunStats — the caller
  // does, after deciding whether to also persist the result into the cache.
  // That lets us record per-call token usage alongside cached chunks/judgements
  // without double-counting.
  const complete = async (req: LLMRequest, label: string): Promise<LLMResponse> => {
    const res = await withRetry(() => client.complete(req), {
      maxRetries,
      initialDelayMs: INITIAL_DELAY_MS,
      maxDelayMs: MAX_DELAY_MS,
      onRetry: ({ attempt, delayMs, kind }) => {
        if (kind === "rate-limit") {
          shrink(`rate-limited (attempt ${attempt}, sleeping ${Math.round(delayMs)}ms)`);
        } else {
          process.stderr.write(
            `[retry] ${kind} on ${label} (attempt ${attempt}, sleeping ${Math.round(delayMs)}ms)\n`,
          );
        }
      },
    });
    recordSuccess();
    return res;
  };

  // --- Pass 1: analyze each chunk ---
  const totalChunks = chunks.length;
  let analyzedCompleted = 0;
  opts.onProgress?.(0, totalChunks);

  const chunkTasks = chunks.map((chunk) =>
    limit(async () => {
      const key = chunkCacheKey(chunk);
      const cached = opts.cache?.getChunk(key);
      if (cached) {
        stats.inputTokens += cached.inputTokens;
        stats.outputTokens += cached.outputTokens;
        stats.analyzeCalls++;
        stats.chunkCacheHits++;
        analyzedCompleted++;
        opts.onProgress?.(analyzedCompleted, totalChunks);
        // Stamp crate (not stored to keep the cache stable across crate renames
        // in workspace re-layouts; we re-derive from the chunk being requested).
        return cached.findings.map((f) => ({ ...f, crate: chunk.file.crate }));
      }
      try {
        const result = await analyzeChunk(chunk, complete);
        stats.inputTokens += result.inputTokens;
        stats.outputTokens += result.outputTokens;
        stats.analyzeCalls++;
        if (opts.cache) {
          await opts.cache.putChunk({
            chunkKey: key,
            // Strip `crate` before persisting: it's metadata, not finding identity.
            findings: result.findings.map(({ crate: _crate, ...rest }) => rest),
            inputTokens: result.inputTokens,
            outputTokens: result.outputTokens,
          });
        }
        return result.findings;
      } catch (e) {
        process.stderr.write(
          `[warn] chunk ${chunk.file.relPath}:${chunk.startLine} failed: ${String(e)}\n`,
        );
        return [] as Finding[];
      } finally {
        analyzedCompleted++;
        opts.onProgress?.(analyzedCompleted, totalChunks);
      }
    }),
  );
  let findings = (await Promise.all(chunkTasks)).flat();

  // --- Pass 2: judge critical findings ---
  if (opts.judge !== false) {
    findings = await runJudgePass(findings, chunks, complete, limit, opts, stats);
  }

  // Sort highest severity first so every downstream consumer (terminal, JSON,
  // HTML report) gets the same canonical ordering. Sort happens AFTER the judge
  // pass because downgrades change severity.
  findings = sortFindingsBySeverity(findings);

  return { findings, stats };
}

const SEVERITY_ORDER: Record<Severity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

export function sortFindingsBySeverity(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => {
    const sevDiff = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    if (sevDiff !== 0) return sevDiff;
    // Tie-break: higher confidence wins.
    if (a.confidence !== b.confidence) return b.confidence - a.confidence;
    // Stable secondary keys for deterministic output across runs.
    if (a.file !== b.file) return a.file < b.file ? -1 : 1;
    return a.line_start - b.line_start;
  });
}

async function runJudgePass(
  findings: Finding[],
  chunks: Chunk[],
  complete: (req: LLMRequest, label: string) => Promise<LLMResponse>,
  limit: ReturnType<typeof pLimit>,
  opts: RunOpts,
  stats: RunStats,
): Promise<Finding[]> {
  const criticalIdx: number[] = [];
  findings.forEach((f, i) => {
    if (f.severity === "critical") criticalIdx.push(i);
  });
  if (criticalIdx.length === 0) return findings;

  // Map relPath → full file content for judge context. We sourced the chunks
  // from these files in the analyze pass, so the content is already in memory.
  const fileContents = new Map<string, string>();
  for (const c of chunks) fileContents.set(c.file.relPath, c.file.content);

  opts.onJudgeStart?.(criticalIdx.length);
  let judgedCompleted = 0;
  opts.onJudgeProgress?.(0, criticalIdx.length);

  const drop = new Set<number>();
  const downgrade = new Map<number, Finding["severity"]>();

  const applyDecision = (idx: number, decision: JudgeDecision, finding: Finding): void => {
    if (decision.kind === "drop") {
      drop.add(idx);
      process.stderr.write(
        `[judge] reject ${finding.rule_id} @ ${finding.file}:${finding.line_start} — ${decision.reason}\n`,
      );
    } else if (decision.kind === "downgrade") {
      downgrade.set(idx, decision.newSeverity);
      process.stderr.write(
        `[judge] downgrade ${finding.rule_id} @ ${finding.file}:${finding.line_start} → ${decision.newSeverity} — ${decision.reason}\n`,
      );
    }
  };

  const judgeTasks = criticalIdx.map((idx) =>
    limit(async () => {
      const finding = findings[idx];
      if (!finding) return;
      const fkey = findingCacheKey(finding);
      const cached = opts.cache?.getJudge(fkey);
      if (cached) {
        stats.inputTokens += cached.inputTokens;
        stats.outputTokens += cached.outputTokens;
        stats.judgeCalls++;
        stats.judgeCacheHits++;
        applyDecision(idx, cached.decision, finding);
        judgedCompleted++;
        opts.onJudgeProgress?.(judgedCompleted, criticalIdx.length);
        return;
      }
      try {
        const fileContent = fileContents.get(finding.file);
        if (!fileContent) {
          // Source file not in our chunk map (shouldn't normally happen).
          // Conservative default: keep the finding.
          return;
        }
        const res = await complete(
          {
            systemPrompt: JUDGE_SYSTEM_PROMPT,
            userPrompt: buildJudgePrompt(finding, fileContent),
            temperature: 0.1,
            maxTokens: 1024,
          },
          `judge ${finding.file}:${finding.line_start}`,
        );
        const inputTokens = res.inputTokens ?? 0;
        const outputTokens = res.outputTokens ?? 0;
        stats.inputTokens += inputTokens;
        stats.outputTokens += outputTokens;
        stats.judgeCalls++;
        const parsed = safeParseJudge(res.text);
        const decision: JudgeDecision = parsed
          ? decideFromJudge(finding, parsed)
          : { kind: "keep" };
        if (opts.cache) {
          await opts.cache.putJudge({
            findingKey: fkey,
            decision,
            inputTokens,
            outputTokens,
          });
        }
        applyDecision(idx, decision, finding);
      } catch (e) {
        process.stderr.write(
          `[warn] judge failed for ${finding.file}:${finding.line_start}: ${String(e)}\n`,
        );
      } finally {
        judgedCompleted++;
        opts.onJudgeProgress?.(judgedCompleted, criticalIdx.length);
      }
    }),
  );
  await Promise.all(judgeTasks);

  const out: Finding[] = [];
  for (let i = 0; i < findings.length; i++) {
    if (drop.has(i)) continue;
    const f = findings[i];
    if (!f) continue;
    const newSev = downgrade.get(i);
    out.push(newSev ? { ...f, severity: newSev } : f);
  }
  return out;
}

interface ChunkResult {
  findings: Finding[];
  inputTokens: number;
  outputTokens: number;
}

async function analyzeChunk(
  chunk: Chunk,
  complete: (req: LLMRequest, label: string) => Promise<LLMResponse>,
): Promise<ChunkResult> {
  const res = await complete(
    {
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: buildUserPrompt(chunk),
      temperature: 0.1,
      maxTokens: 2048,
    },
    `${chunk.file.relPath}:${chunk.startLine}`,
  );
  const parsed = safeParse(res.text);
  const findings: Finding[] = parsed
    ? parsed.findings
        .filter((f) => isEvidenceInChunk(f.evidence, chunk.content))
        .map((f) => ({ ...f, crate: chunk.file.crate }))
    : [];
  return {
    findings,
    inputTokens: res.inputTokens ?? 0,
    outputTokens: res.outputTokens ?? 0,
  };
}

function safeParse(text: string): { findings: Finding[] } | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < 0 || end <= start) return null;
  try {
    const obj = JSON.parse(text.slice(start, end + 1));
    const r = AnalysisResponseSchema.safeParse(obj);
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

function isEvidenceInChunk(evidence: string, content: string): boolean {
  const norm = (s: string) => s.replace(/\s+/g, " ").trim();
  return norm(content).includes(norm(evidence));
}
