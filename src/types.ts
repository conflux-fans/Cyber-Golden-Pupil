export type Severity = "critical" | "high" | "medium" | "low" | "info";

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
