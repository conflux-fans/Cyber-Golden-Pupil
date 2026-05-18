export type Severity = "critical" | "high" | "medium" | "low" | "info";

/**
 * `safety` — the original mode: memory safety, casts, FFI, crypto misuse, injection.
 * `logic`  — logic bugs, DDoS / resource exhaustion, unsound concurrency design,
 *            implementation vulnerabilities (broken invariants, TOCTOU, error swallowing, etc.).
 * `panic`  — every reachable crash path: explicit panics, unwrap/expect on values that
 *            can be Err/None at runtime, indexing/slicing OOB, divide-by-zero / overflow,
 *            RefCell borrow conflicts, lock poisoning, channel send/recv unwraps,
 *            panics in Drop or across FFI, stack overflow from recursion.
 */
export type ScanMode = "safety" | "logic" | "panic";

export const SCAN_MODES: readonly ScanMode[] = ["safety", "logic", "panic"] as const;

export interface Finding {
  rule_id: string;
  severity: Severity;
  cwe?: string;
  crate?: string;
  file: string;
  line_start: number;
  line_end: number;
  summary: string;
  evidence: string;
  fix_suggestion: string;
  confidence: number;
}

export interface SourceFile {
  absPath: string;
  relPath: string;
  content: string;
  language: "rust";
  crate: string;
}

export interface Chunk {
  file: SourceFile;
  startLine: number;
  endLine: number;
  content: string;
  hints: string[];
}
