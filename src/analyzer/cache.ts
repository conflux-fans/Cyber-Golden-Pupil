import { open, mkdir, readFile, type FileHandle } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import type { Chunk, Finding } from "../types.js";
import type { JudgeDecision } from "./judge.js";

const CACHE_VERSION = 1;

export interface ScanCacheKey {
  projectPath: string;
  provider: string;
  model: string;
  unit: string;
  judge: boolean;
  crates: string[];
}

export interface ChunkCacheEntry {
  chunkKey: string;
  findings: Finding[];
  inputTokens: number;
  outputTokens: number;
}

export interface JudgeCacheEntry {
  findingKey: string;
  decision: JudgeDecision;
  inputTokens: number;
  outputTokens: number;
}

interface MetaRecord {
  type: "meta";
  v: number;
  provider: string;
  model: string;
  unit: string;
  judge: boolean;
  projectPath: string;
  crates: string[];
  createdAt: string;
}

interface ChunkRecord extends ChunkCacheEntry {
  type: "chunk";
}

interface JudgeRecord extends JudgeCacheEntry {
  type: "judge";
}

/**
 * Append-only JSONL cache for resumable scans. Each completed chunk and judge
 * call writes one line. On the next run we read the file, skip any chunk /
 * judgement we already have, and continue from where we left off.
 *
 * The chunk key embeds a content hash, so source edits between runs naturally
 * invalidate stale entries without needing an explicit `--force` flag.
 */
export class ScanCache {
  private handle: FileHandle | null = null;
  private chunks = new Map<string, ChunkCacheEntry>();
  private judges = new Map<string, JudgeCacheEntry>();
  // Promise chain serializes writes so concurrent workers don't interleave bytes.
  private writeChain: Promise<void> = Promise.resolve();
  readonly path: string;

  constructor(path: string) {
    this.path = path;
  }

  static computePath(cacheDir: string, projectName: string, key: ScanCacheKey): string {
    const sortedKey: ScanCacheKey = { ...key, crates: [...key.crates].sort() };
    const hash = createHash("sha256")
      .update(JSON.stringify(sortedKey))
      .digest("hex")
      .slice(0, 12);
    const slug = [projectName, key.provider, key.model]
      .map(sanitizeForFilename)
      .join("-");
    return resolve(cacheDir, `${slug}-${hash}.jsonl`);
  }

  /** Read every record from disk into memory. Tolerates partial / truncated last lines. */
  async load(): Promise<{ chunkHits: number; judgeHits: number }> {
    if (!existsSync(this.path)) return { chunkHits: 0, judgeHits: 0 };
    const text = await readFile(this.path, "utf8");
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let rec: unknown;
      try {
        rec = JSON.parse(trimmed);
      } catch {
        continue;
      }
      const r = rec as { type?: string };
      if (r.type === "chunk") {
        const c = rec as ChunkRecord;
        this.chunks.set(c.chunkKey, {
          chunkKey: c.chunkKey,
          findings: c.findings,
          inputTokens: c.inputTokens,
          outputTokens: c.outputTokens,
        });
      } else if (r.type === "judge") {
        const j = rec as JudgeRecord;
        this.judges.set(j.findingKey, {
          findingKey: j.findingKey,
          decision: j.decision,
          inputTokens: j.inputTokens,
          outputTokens: j.outputTokens,
        });
      }
    }
    return { chunkHits: this.chunks.size, judgeHits: this.judges.size };
  }

  async openForWrite(key: ScanCacheKey): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const isNew = !existsSync(this.path);
    this.handle = await open(this.path, "a");
    if (isNew) {
      const meta: MetaRecord = {
        type: "meta",
        v: CACHE_VERSION,
        provider: key.provider,
        model: key.model,
        unit: key.unit,
        judge: key.judge,
        projectPath: key.projectPath,
        crates: [...key.crates].sort(),
        createdAt: new Date().toISOString(),
      };
      await this.appendLine(meta);
    }
  }

  getChunk(key: string): ChunkCacheEntry | undefined {
    return this.chunks.get(key);
  }

  getJudge(key: string): JudgeCacheEntry | undefined {
    return this.judges.get(key);
  }

  async putChunk(entry: ChunkCacheEntry): Promise<void> {
    this.chunks.set(entry.chunkKey, entry);
    await this.appendLine({ type: "chunk", ...entry } satisfies ChunkRecord);
  }

  async putJudge(entry: JudgeCacheEntry): Promise<void> {
    this.judges.set(entry.findingKey, entry);
    await this.appendLine({ type: "judge", ...entry } satisfies JudgeRecord);
  }

  async close(): Promise<void> {
    await this.writeChain;
    if (this.handle) {
      await this.handle.close();
      this.handle = null;
    }
  }

  private appendLine(obj: unknown): Promise<void> {
    const line = JSON.stringify(obj) + "\n";
    this.writeChain = this.writeChain.then(async () => {
      if (this.handle) await this.handle.write(line);
    });
    return this.writeChain;
  }
}

export function chunkCacheKey(chunk: Chunk): string {
  const contentHash = createHash("sha1")
    .update(chunk.content)
    .digest("hex")
    .slice(0, 12);
  return `${chunk.file.crate}/${chunk.file.relPath}:${chunk.startLine}-${chunk.endLine}#${contentHash}`;
}

export function findingCacheKey(f: Finding): string {
  const evidenceHash = createHash("sha1")
    .update(f.evidence)
    .digest("hex")
    .slice(0, 8);
  return `${f.file}:${f.line_start}-${f.line_end}#${f.rule_id}#${evidenceHash}`;
}

function sanitizeForFilename(s: string): string {
  const cleaned = s.replace(/[\/\\:*?"<>|\s\x00-\x1f]+/g, "-");
  const trimmed = cleaned.replace(/^[-.]+|[-.]+$/g, "");
  return trimmed || "scan";
}
