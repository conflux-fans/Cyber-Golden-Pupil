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
