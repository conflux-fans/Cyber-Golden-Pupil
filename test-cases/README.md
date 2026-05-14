# Test Cases

Two Rust fixture projects used to smoke-test the scanner end-to-end.

## `vulnerable-app/`

A deliberately broken backend-style crate. Every file demonstrates a distinct
class of security or correctness issue. Used to verify that the scanner
**detects** real problems.

A correct scan should produce findings spanning at least:
unsafe / FFI / transmute, SQL injection, command injection, path traversal,
weak crypto + hardcoded secrets, integer truncation/overflow, lock-ordering
deadlock, untrusted deserialization, and panic-prone `.unwrap()`.

## `safe-app/`

A small, idiomatic crate that avoids every regex hint the prefilter looks for:
no `unsafe`, no `.unwrap()`/`.expect(`, no `as` casts on integer primitives,
no `Command::new`, no `std::fs::`, no `transmute`, no `serde_json::from_*`,
no `extern "C"` / `#[no_mangle]`. Used to verify the scanner **doesn't
hallucinate** issues in clean code — ideally a scan reports zero findings.

## Running

```bash
# from the repo root
npm run dev -- scan test-cases/vulnerable-app --provider <provider> --dry-run
npm run dev -- scan test-cases/vulnerable-app --provider <provider>
npm run dev -- scan test-cases/safe-app       --provider <provider>
```

The reports land in cwd as `vulnerable-app-<provider>-<model>.html` and
`safe-app-<provider>-<model>.html`.

## Ground truth

Each fixture has a `ground-truth.yaml` describing every bug a correct scan
should surface (`vulnerable-app/`) or the expected absence of findings
(`safe-app/`). The schema is documented inline at the top of the YAML. The
evaluator consumes one ground-truth file plus one scanner report and emits:

- **recall** — `must_detect` findings hit / total `must_detect` findings
- **precision** — reported findings that match ground truth / total reported
- **severity confusion matrix** — predicted vs. expected severity for hits
- **stability** — Jaccard similarity across N repeated runs of the same scan

### Matching rules

A reported finding matches a ground-truth entry when:

1. `file` is identical (path relative to the fixture root)
2. the reported `[line_start, line_end]` overlaps the ground-truth range
   extended by `match_policy.line_slack` on each side
3. the scanner's `rule_id` or category equals the ground-truth `category` or
   any string in its `aliases`, case-insensitive

`must_detect: false` entries are bonus credit: hits add to precision but
misses do not subtract from recall. Use this for low-severity or borderline
patterns you want to track without making them blocking.

### Updating ground truth

Treat `id` as stable: never reuse an id after deleting it, and never
renumber. When the fixture source changes, update the affected entry's line
range in the same commit so the matcher does not silently start missing it.

## Running the evaluator

```bash
# 1. produce a JSON scan report
npm run dev -- scan test-cases/vulnerable-app \
  --provider <provider> \
  --report ./vulnerable.json

# 2. score it against ground truth
npm run eval -- ./vulnerable.json \
  -g test-cases/vulnerable-app/ground-truth.yaml
```

The evaluator prints recall, precision, missed must-detect entries, false
positives, and a severity confusion matrix. Pass `-o json` for a
machine-readable summary suitable for CI dashboards.

### CI gating

`--min-recall` and `--min-precision` make the command exit non-zero when
either threshold is missed. Useful as a regression gate:

```bash
npm run eval -- ./vulnerable.json \
  -g test-cases/vulnerable-app/ground-truth.yaml \
  --min-recall 0.8 --min-precision 0.7
```

For `safe-app/`, set `--min-precision 1.0` — any finding is a false positive
by construction.
