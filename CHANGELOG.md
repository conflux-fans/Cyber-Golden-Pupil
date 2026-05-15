# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Resumable scans.** Each completed chunk and judge call is appended to a
  JSONL cache as it finishes, so a scan interrupted by `Ctrl-C`, a crash, or a
  network drop can be continued on the next run without re-spending tokens on
  already-finished work.
  - New CLI flags: `--cache-dir <dir>` (default `./.ai-bug-scanner-cache`) and
    `--no-resume` to ignore any existing cache.
  - Cache files are keyed by `(project, provider, model, unit, judge, crates)`
    so different configurations never collide.
  - Chunk identity embeds a content hash, so source edits between runs
    automatically invalidate stale entries — no `--force` needed.
  - On resume, the progress line reports cache hits, and `RunStats` exposes
    `chunkCacheHits` / `judgeCacheHits`.

## [0.0.1] — initial scaffold

### Added

- End-to-end CLI pipeline for AI-assisted Rust security scanning:
  walker → prefilter → LLM analyzer → reporter.
- Three chunking strategies, selectable via `--unit`:
  - `ast-function` (default, tree-sitter)
  - `function` (regex windowed)
  - `file` (whole file)
  - Automatic fallback from `ast-function` to windowed mode on parse failure.
- LLM-as-judge second pass on `critical` findings (`--no-judge` to skip),
  which can `confirm`, `reject`, or `downgrade` each one with the full file as
  context.
- Per-run report file written to `./<project>-<provider>-<model>.html` by
  default; format inferred from extension (`.html` | `.json`).
- Six LLM providers wired up: `kimi`, `glm`, `openrouter`, `deepseek`, `mimo`,
  `mimo-anthropic`.
- Retry + dynamic-concurrency layer that honors `Retry-After`, exponentially
  backs off on `429` / `5xx` / network errors, halves in-flight concurrency
  on rate-limit, and slowly recovers after sustained success.
- `evaluate` subcommand: score a scan report against a ground-truth YAML.
- Initial unit-test suite covering retry classification, prefilter chunking
  (all three units), AST function extraction, judge decision mapping, and
  report serialization.

[Unreleased]: https://github.com/conflux-fans/Cyber-Golden-Pupil/compare/v0.0.1...HEAD
[0.0.1]: https://github.com/conflux-fans/Cyber-Golden-Pupil/releases/tag/v0.0.1
