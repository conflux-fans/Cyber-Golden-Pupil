# Architecture

> See `intro.md` for the project vision. This document describes the implementation layout of the scaffolded skeleton.

## Layered pipeline

```
CLI (commander)
   ↓
Project Ingestion   (scanner/project.ts)      detect Cargo.toml, derive name
   ↓
File Walker         (scanner/walker.ts)       globby + .gitignore, skip target/
   ↓
Prefilter           (scanner/prefilter.ts)    regex heuristics → candidate chunks
   ↓
LLM Analyzer        (analyzer/runner.ts)      p-limit concurrent LLM calls
   ↓                (analyzer/prompts.ts)     system + user prompt templates
   ↓                (analyzer/schema.ts)      zod validation of model output
Reporter            (reporter/terminal.ts | reporter/json.ts)
```

## Module map

```
src/
  cli.ts                       Entry point. Parses argv, dispatches commands.
  types.ts                     Shared types: Finding, SourceFile, Chunk, Severity.

  commands/
    scan.ts                    Orchestrates the full pipeline for `scan`.

  config/
    index.ts                   Provider registry + env-based config loader.

  providers/
    base.ts                    LLMClient interface (complete()).
    openai-compatible.ts       Kimi / GLM / OpenRouter / Mimo (OpenAI proto).
    anthropic-compatible.ts    Mimo (Anthropic proto) and future Anthropic vendors.
    factory.ts                 Selects implementation by ProviderConfig.protocol.

  scanner/
    project.ts                 Reads Cargo.toml; resolves workspace members → Crate[].
    walker.ts                  Per-crate *.rs walk, attributes each file to innermost crate.
    prefilter.ts               Risk-hint gating → chunks. Dispatches to ast / window / file.
    ast.ts                     tree-sitter-rust function-level chunker.

  analyzer/
    prompts.ts                 SYSTEM_PROMPT + buildUserPrompt(chunk).
    schema.ts                  zod schemas for LLM JSON output.
    runner.ts                  Concurrent dispatch, parsing, evidence verification.

  reporter/
    terminal.ts                Human-readable colored output.
    json.ts                    Machine-readable JSON output.
```

## Key design decisions

### 1. Two protocol classes only

All five named providers fall into two protocol shapes — OpenAI-compatible or Anthropic-compatible. Adding a vendor is one entry in `PROVIDERS` (in `config/index.ts`) with `protocol`, default base URL and model. No new client code unless a vendor introduces a third protocol.

### 2. Prefilter before LLM

The same regex rule set (`unsafe`, FFI, `unwrap`, casts, `Command`, sql/fs/net/crypto/serde, `transmute`) is used as a **gating signal** across all chunking modes — code with zero hits is dropped before the LLM ever sees it. What differs is the granularity at which the gate is applied, controlled by `--unit`:

- `--unit ast-function` (default) — `scanner/ast.ts` parses each file with `tree-sitter-rust` and walks the AST to extract every `function_item` / `function_signature_item`, including methods inside `impl`/`trait`/`mod` blocks and FFI signatures inside `extern "C" { ... }`. Each function body is then evaluated against the rule set; only functions with at least one hit become chunks. The chunk content is the function body plus a small contextual preamble (file-level `use` statements + the enclosing `impl`/`trait`/`mod` header line) so the LLM has type/scope context. Line numbers in the chunk still point at the real function in the file. If the parser fails on a file, that file falls back to windowed mode automatically.
- `--unit function` — context window of `[hit-10, hit+80]` lines around each rule hit; overlapping windows are merged. Cheap, no parser dependency, but cuts across function boundaries on dense files.
- `--unit file` — one chunk per file that has any rule hit, content is the whole file. More complete cross-function context at the cost of tokens and "lost-in-the-middle" risk on large files.

`ast-function` is the recommended default: it produces tighter, semantically-meaningful chunks (one fn = one chunk) which both reduces LLM cost on hit-dense files and improves line-number precision in findings.

### 3. Structured output + evidence verification

The LLM is forced to return a JSON object matching `AnalysisResponseSchema` (zod). After parsing, `runner.ts` drops any finding whose `evidence` field is not a verbatim substring of the chunk's source (normalized for whitespace). This catches a class of hallucinations where the model invents code that does not exist.

### 4. Concurrency, not parallelism

`p-limit` is used to cap concurrent in-flight LLM requests. The default is 4 — high enough to amortize network latency, low enough to stay under most providers' RPM limits without explicit rate-limit handling. Tune via `--concurrency`.

### 5. `--dry-run`

Always run a `--dry-run` first against a new project. It exposes what the prefilter found, lets you estimate how many LLM calls you are about to make, and surfaces obvious prefilter false positives before they cost money.

## Extension points

| Want to add...               | Touch...                                          |
| ---------------------------- | ------------------------------------------------- |
| A new LLM provider           | `src/config/index.ts` (registry entry)            |
| A new protocol               | `src/providers/*.ts` + `factory.ts`               |
| Better chunking (AST)        | `src/scanner/ast.ts`                              |
| A new rule hint              | `RULES` array in `src/scanner/prefilter.ts` AND `src/scanner/ast.ts` (kept in sync) |
| A new output format (SARIF)  | `src/reporter/<format>.ts` + branch in `scan.ts`  |
| Dependency / CVE checks      | new `src/scanner/cargo_audit.ts` (shells out to `cargo audit`) |
| A new top-level command      | `src/commands/<cmd>.ts` + register in `cli.ts`    |

## Workspace handling

`project.ts` parses the root `Cargo.toml` with `smol-toml`:

- If `[workspace]` exists, expand `members` (glob patterns like `crates/*` allowed) and respect `exclude`. Each member crate becomes a `Crate { name, rootDir, manifestPath }`.
- A workspace root may itself be a crate (`[workspace]` + `[package]`); both are included.
- A non-workspace single crate is normalized to a 1-element `crates` array, so downstream code never branches on workspace vs. single-crate.

`walker.ts` walks each crate's directory with `globby`. For nested workspaces (a member containing another crate), files go to the **innermost** crate that contains them — `walkCrates` sorts crates by descending path length so deeper roots claim files first.

`Finding.crate` is injected in `analyzer/runner.ts` after the LLM response is parsed (the model is not expected to fill it). The terminal reporter groups findings by crate. `--crate <name>` (repeatable) filters which crates are scanned.

## Non-goals (for now)

- **Multi-language**: only Rust is wired up. The `language` field on `SourceFile` is a literal `"rust"` placeholder for when this changes.
- **Caching**: every run re-analyzes everything. Add a content-hash cache later if cost becomes a concern.
- **Auto-fix**: findings include `fix_suggestion` text but the tool does not modify source.
- **CI integration**: SARIF / GitHub Code Scanning support is intentionally deferred.
