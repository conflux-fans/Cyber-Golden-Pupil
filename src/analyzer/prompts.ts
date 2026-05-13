import type { Chunk } from "../types.js";

export const SYSTEM_PROMPT = `You are a senior Rust security auditor.
You examine code snippets and report real, exploitable issues.

Focus on:
- Memory safety inside \`unsafe\` blocks (aliasing, lifetimes, alignment)
- Panic risks from unwrap/expect on attacker-controlled input
- Integer overflow / unchecked \`as\` casts
- Concurrency: data races, lock ordering, Send/Sync soundness
- FFI boundary issues (null, lifetime, layout)
- Deserialization of untrusted input
- Command/SQL/path injection
- Cryptographic misuse (weak primitives, predictable RNG, hardcoded keys/secrets)

Rules:
- If a snippet has no real issue, return an empty findings array.
- Do not flag stylistic concerns or "could panic in theory" without untrusted input flow.
- "evidence" MUST be a verbatim copy of the offending lines from the snippet.
- "line_start" and "line_end" MUST use the ABSOLUTE line numbers shown in the snippet header,
  not relative to the snippet.

Output STRICTLY this JSON object and nothing else:
{
  "findings": [
    {
      "rule_id": "kebab-case-rule-id",
      "severity": "critical" | "high" | "medium" | "low" | "info",
      "cwe": "CWE-XXX",
      "file": "path/to/file.rs",
      "line_start": 123,
      "line_end": 125,
      "summary": "short one-line summary",
      "evidence": "verbatim offending code",
      "fix_suggestion": "concrete fix",
      "confidence": 0.0
    }
  ]
}`;

export function buildUserPrompt(chunk: Chunk): string {
  return [
    `Crate: ${chunk.file.crate}`,
    `File: ${chunk.file.relPath}`,
    `Lines: ${chunk.startLine}-${chunk.endLine}`,
    `Prefilter hints: ${chunk.hints.join(", ") || "none"}`,
    "",
    "```rust",
    chunk.content,
    "```",
    "",
    "Return only the JSON object. No prose.",
  ].join("\n");
}
