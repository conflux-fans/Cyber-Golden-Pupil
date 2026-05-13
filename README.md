# AI Bug Scanner

CLI for AI-assisted security scanning of Rust projects. See [`intro.md`](./intro.md) for the project vision and [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the design.

## Quick start

```bash
npm install
cp .env.example .env       # fill in at least one provider's API key
npm run build
node dist/cli.js scan /path/to/rust-project --provider kimi
```

Dev mode (no build needed):

```bash
npm run dev -- scan /path/to/rust-project --dry-run
```

## CLI

```
ai-bug-scanner scan <dir> [options]

  -p, --provider <name>   LLM provider (kimi | glm | openrouter | deepseek | mimo | mimo-anthropic)
  -o, --output <format>   terminal | json   (default: terminal)
      --unit <unit>       chunking unit: ast-function (default, tree-sitter) | function (regex windowed) | file (whole file)
      --crate <name>      limit to specific crate(s); repeatable
      --max-files <n>     cap analyzed files
      --concurrency <n>   parallel LLM calls (default: 4)
      --max-retries <n>   retries per chunk on 429 / 5xx / network errors (default: 5)
      --no-judge          skip the LLM-as-judge second pass on critical findings
      --report <path>     write a full-run report file; format from extension (.html | .json), default: ./<project>-<provider>-<model>.html
      --no-report         do not write a report file
      --dry-run           print prefilter chunks without calling the LLM
```

### Per-run report file

Every non-dry-run scan writes a report capturing the full context of the run, not just the findings. The default format is **HTML** — a self-contained document (inline CSS, no external assets) you can open in any browser, email, or archive. Findings are listed in a color-coded table ordered **critical → high → medium → low → info**.

Default path: `./<project>-<provider>-<model>.html` in cwd, so scans of different projects or the same project under different LLMs don't overwrite each other. Path-separator-bearing model ids like `anthropic/claude-sonnet-4` are flattened with dashes.

The format is picked from the file extension:

| `--report` value | Format |
|---|---|
| `…/foo.html` *(or no `--report` at all)* | HTML |
| `…/foo.json` | JSON |
| any other extension | HTML |

JSON shape (when `.json`):

```jsonc
{
  "scan":    { "started_at": "...", "finished_at": "...", "duration_ms": 12345 },
  "project": { "name": "...", "path": "...", "is_workspace": false,
               "crates": ["..."], "file_count": 47, "line_count": 8392 },
  "model":   { "provider": "kimi", "model": "kimi-k2.6", "base_url": "...", "protocol": "openai" },
  "config":  { "unit": "ast-function", "concurrency": 4, "max_retries": 5, "judge": true },
  "tokens":  { "input": 312840, "output": 14201, "total": 327041,
               "analyze_calls": 38, "judge_calls": 3 },
  "findings": [ /* same shape as --output json, sorted by severity desc */ ]
}
```

Use `--no-report` to skip writing entirely. The stdout `--output json` form is unchanged and still emits only the findings array — the report file is the persistent, fuller record.

### LLM-as-judge (second pass on critical findings)

After the first analyze pass, every `critical` finding is re-checked by an independent LLM call that receives the **entire source file** as context (not just the original chunk). The judge returns one of:

- `confirm`   — keep the finding as-is
- `reject`    — drop the finding (typical: test code, `#[cfg(test)]` paths, validated input, dead code)
- `downgrade` — keep but lower severity to a more accurate level (e.g. `medium`)

Verdicts are logged to stderr (`[judge] reject ...` / `[judge] downgrade ...`). Pass `--no-judge` to skip this pass — useful for cost-sensitive runs or when you want to see the raw first-pass output. The judge phase reuses the same retry + dynamic-concurrency layer, so it inherits any rate-limit backoff already in effect.

### Rate-limit handling

Each LLM call is wrapped in a retry layer that:

- Honors the vendor's `Retry-After` header when present, otherwise applies exponential backoff with jitter (2s → 60s).
- Retries only on `429`, `5xx`, and transient network errors. `4xx` (auth, bad request) fails immediately.
- **Auto-throttles concurrency** on rate-limit: each 429 halves the in-flight cap (down to 1); after 10 successful calls under a reduced cap, the limit recovers by one. This lets you set `--concurrency` aggressively without manually tuning per provider.
- The provider SDKs' built-in retries are disabled so backoff is not doubled.

## Supported providers

| Name              | Protocol             | Required env                                          |
| ----------------- | -------------------- | ----------------------------------------------------- |
| `kimi`            | OpenAI-compatible    | `KIMI_API_KEY` (+ optional `KIMI_BASE_URL`, `KIMI_MODEL`) |
| `glm`             | OpenAI-compatible    | `GLM_API_KEY` (+ optional `GLM_BASE_URL`, `GLM_MODEL`)    |
| `openrouter`      | OpenAI-compatible    | `OPENROUTER_API_KEY` (+ optional base/model)              |
| `deepseek`        | OpenAI-compatible    | `DEEPSEEK_API_KEY` (+ optional `DEEPSEEK_BASE_URL`, `DEEPSEEK_MODEL`) |
| `mimo`            | OpenAI-compatible    | `MIMO_API_KEY` (+ optional base/model)                    |
| `mimo-anthropic`  | Anthropic-compatible | `MIMO_API_KEY` (+ optional `MIMO_ANTHROPIC_BASE_URL`)     |

Adding a new provider = one entry in `src/config/index.ts` plus an env var.

## Status

This is a scaffolded skeleton:

- End-to-end pipeline wired up (CLI → walker → prefilter → LLM → reporter).
- Three chunking strategies: `ast-function` (tree-sitter, default), `function` (regex windowed), `file` (whole file).
- Tree-sitter falls back to windowed mode automatically on parse failure.
- Core unit tests live in `test/` (run with `npm test`): retry / backoff classification, prefilter chunking across all three units, AST function extraction, judge decision mapping.
- SARIF reporter is not implemented; only `terminal` and `json` exist.
