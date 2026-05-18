import type { Chunk, ScanMode, SourceFile } from "../types.js";
import { chunkFileByAst } from "./ast.js";
import { getRules, type Rule } from "./rules.js";

export type ChunkingUnit = "function" | "file" | "ast-function";

const CONTEXT_BEFORE = 10;
const WINDOW_AFTER = 80;

export function prefilter(
  files: SourceFile[],
  unit: ChunkingUnit = "function",
  mode: ScanMode = "safety",
): Chunk[] {
  const rules = getRules(mode);
  if (unit === "file") return prefilterByFile(files, rules);
  if (unit === "ast-function") return prefilterByAst(files, rules, mode);
  return prefilterByWindow(files, rules);
}

/**
 * AST-driven function-level chunking. Falls back to windowed chunking on a
 * per-file basis when tree-sitter cannot parse the file (e.g. malformed source
 * or future Rust syntax the bundled grammar does not yet support).
 */
function prefilterByAst(files: SourceFile[], rules: Rule[], mode: ScanMode): Chunk[] {
  const chunks: Chunk[] = [];
  for (const file of files) {
    const astChunks = chunkFileByAst(file, mode);
    if (astChunks === null) {
      // Parser failure → keep the file safe, fall back to windowed mode.
      chunks.push(...prefilterByWindow([file], rules));
      continue;
    }
    chunks.push(...astChunks);
  }
  return chunks;
}

/** One chunk per file that has at least one rule hit, covering the whole file. */
function prefilterByFile(files: SourceFile[], rules: Rule[]): Chunk[] {
  const chunks: Chunk[] = [];
  for (const file of files) {
    const hintSet = new Set<string>();
    const lines = file.content.split("\n");
    for (const line of lines) {
      for (const r of rules) {
        if (r.re.test(line)) hintSet.add(r.hint);
      }
    }
    if (hintSet.size === 0) continue;
    chunks.push({
      file,
      startLine: 1,
      endLine: lines.length,
      content: file.content,
      hints: [...hintSet],
    });
  }
  return chunks;
}

/** Windowed chunks around each rule hit. Adjacent windows are merged. */
function prefilterByWindow(files: SourceFile[], rules: Rule[]): Chunk[] {
  const chunks: Chunk[] = [];
  for (const file of files) {
    const lines = file.content.split("\n");
    const hits = new Map<number, Set<string>>();
    lines.forEach((line, i) => {
      for (const r of rules) {
        if (r.re.test(line)) {
          let set = hits.get(i);
          if (!set) {
            set = new Set();
            hits.set(i, set);
          }
          set.add(r.hint);
        }
      }
    });
    if (hits.size === 0) continue;

    const sortedLines = [...hits.keys()].sort((a, b) => a - b);
    let curStart = -1;
    let curEnd = -1;
    let curHints = new Set<string>();

    const flush = () => {
      if (curStart < 0) return;
      const start = Math.max(0, curStart);
      const end = Math.min(lines.length - 1, curEnd);
      chunks.push({
        file,
        startLine: start + 1,
        endLine: end + 1,
        content: lines.slice(start, end + 1).join("\n"),
        hints: [...curHints],
      });
    };

    for (const i of sortedLines) {
      const s = Math.max(0, i - CONTEXT_BEFORE);
      const e = Math.min(lines.length - 1, i + WINDOW_AFTER);
      const lineHits = hits.get(i)!;
      if (curStart < 0) {
        curStart = s;
        curEnd = e;
        curHints = new Set(lineHits);
      } else if (s <= curEnd + 1) {
        curEnd = Math.max(curEnd, e);
        for (const h of lineHits) curHints.add(h);
      } else {
        flush();
        curStart = s;
        curEnd = e;
        curHints = new Set(lineHits);
      }
    }
    flush();
  }
  return chunks;
}
