# Benchmarks

Real-world Rust CVE corpus used to measure the scanner on code humans actually
ship. Distinct from `test-cases/` (hand-written fixtures): annotated ground
truth derived from public advisories, larger surface area, real production
code patterns.

`README.md` and `ground-truth/` are tracked in git; `advisory-db/` and `cves/`
are gitignored (external sources, rebuildable on demand).

## Layout

```
benchmarks/
├── README.md            # this file
├── advisory-db/         # shallow clone of github.com/rustsec/advisory-db (gitignored)
├── cves/                # unpacked crate sources (gitignored)
│   ├── memoffset-0.6.1/
│   ├── elf_rs-0.2.0/
│   ├── borsh-0.10.3/
│   ├── ascii-0.8.7/
│   ├── rust-embed-impl-6.1.0/
│   └── tower-http-0.2.0/
└── ground-truth/        # one YAML per CVE, tracked
    ├── memoffset-0.6.1.yaml
    ├── elf_rs-0.2.0.yaml
    ├── borsh-0.10.3.yaml
    ├── ascii-0.8.7.yaml
    ├── rust-embed-impl-6.1.0.yaml
    └── tower-http-0.2.0.yaml
```

Each `cves/<crate>-<version>/` is the unpacked crates.io tarball of the
**last vulnerable release** before the advisory's patched version. Scanning
it should surface the documented bug; scanning the next version up should
not.

Corpus totals: **9 must-detect findings + 4 bonus** across 6 crates.

## How to (re)build

```bash
# advisory metadata (~5 MB, mostly TOML)
git clone --depth 1 https://github.com/rustsec/advisory-db.git \
  benchmarks/advisory-db

# one vulnerable crate version
mkdir -p benchmarks/cves && cd benchmarks/cves
curl -sL -A "ai-bug-scanner-eval/0.1" \
  https://crates.io/api/v1/crates/<crate>/<version>/download \
  -o <crate>-<version>.crate
tar -xf <crate>-<version>.crate && rm <crate>-<version>.crate
```

## The corpus

Brief notes on each entry. Read the linked advisory for the full story.

### 1. memoffset 0.6.1 — `RUSTSEC-2023-0045`

- **Category**: memory-corruption (unsoundness)
- **CWE**: CWE-908 (use of uninitialized resource)
- **Bug**: `offset_of!` dereferenced uninitialized memory via
  `std::mem::align_of` / `std::mem::uninitialized`, producing UB for types
  that disallow uninit bit-patterns.
- **Fix**: 0.6.2 switched to `std::ptr::addr_of`.
- **Scanner difficulty**: medium — requires understanding `unsafe` blocks and
  intrinsic semantics; the smell (`mem::uninitialized` + dereference) is local.
- **Advisory**: [`benchmarks/advisory-db/crates/memoffset/RUSTSEC-2023-0045.md`](advisory-db/crates/memoffset/RUSTSEC-2023-0045.md)

### 2. elf_rs 0.2.0 — `RUSTSEC-2022-0079`

- **Category**: memory-corruption
- **CWE**: CWE-125 (out-of-bounds read), CWE-20 (improper input validation)
- **Bug**: ELF header parser reads an attacker-controlled offset (e.g.
  `section_header_offset`) and does `ptr.add(off)` without bounds-checking
  against the input slice. Malformed input can construct a wild pointer
  inside a safe-looking API.
- **Fix**: 0.3.0 added range checks.
- **Scanner difficulty**: easy — the advisory quotes the exact buggy
  function. A scanner that flags "unsafe pointer arithmetic with untrusted
  offset" will hit it.
- **Advisory**: [`benchmarks/advisory-db/crates/elf_rs/RUSTSEC-2022-0079.md`](advisory-db/crates/elf_rs/RUSTSEC-2022-0079.md)

### 3. borsh 0.10.3 — `RUSTSEC-2023-0033`

- **Category**: memory-corruption / insecure-deserialization
- **CWE**: CWE-502 (deserialization of untrusted data)
- **Bug**: Deserializing N instances of a non-`Copy` ZST produced a vector
  that, when accessed, segfaulted. Trusted attacker-controlled length on a
  type with custom semantics.
- **Fix**: 0.10.4 / 1.0.0-alpha.1 reject the pattern.
- **Scanner difficulty**: hard — bug is at the trait/generic-parameter level,
  not in a single function. Realistic stress test for an AI scanner.
- **Advisory**: [`benchmarks/advisory-db/crates/borsh/RUSTSEC-2023-0033.md`](advisory-db/crates/borsh/RUSTSEC-2023-0033.md)

### 4. ascii 0.8.7 — `RUSTSEC-2023-0015`

- **Category**: memory-corruption (unsoundness)
- **CWE**: CWE-125 (out-of-bounds read)
- **Bug**: `From<&mut AsciiStr> for &mut [u8]` / `for &mut str` let safe code
  write non-ASCII bytes into a `&mut AsciiStr`, then read them back as a
  `&str` — UB via invalid UTF-8.
- **Fix**: 0.9.3 removed the impls.
- **Scanner difficulty**: hard — bug is a soundness hole in a `From` impl, no
  raw pointer or `unsafe` block on the offending lines. Mostly a stress test
  for trait-level reasoning.
- **Advisory**: [`benchmarks/advisory-db/crates/ascii/RUSTSEC-2023-0015.md`](advisory-db/crates/ascii/RUSTSEC-2023-0015.md)

### 5. rust-embed-impl 6.1.0 — `RUSTSEC-2021-0126`

- **Category**: file-disclosure (path traversal)
- **CWE**: CWE-22 (path traversal)
- **Bug**: The `#[derive(RustEmbed)]` codegen in debug mode (without the
  `debug-embed` feature) reads files from disk without canonicalising and
  checking the prefix, so `../../../etc/passwd` works.
- **Fix**: rust-embed-impl 6.2.0 added a canonicalize-and-prefix-check (the
  outer `rust-embed` wrapper crate was bumped to 6.3.0 for this).
- **Scanner difficulty**: hardest — bug is inside `quote!{}` codegen, not in
  directly executable code. A scanner that doesn't expand proc-macros will
  see token streams, not paths. Included as a negative-control / upper bound.
- **Advisory**: [`benchmarks/advisory-db/crates/rust-embed/RUSTSEC-2021-0126.md`](advisory-db/crates/rust-embed/RUSTSEC-2021-0126.md)
- **Note**: We pin `rust-embed-impl 6.1.0` (the proc-macro crate), not the
  outer `rust-embed` trait crate (which only re-exports). 6.1.0 is the last
  proc-macro release before the canonicalize check landed.

### 6. tower-http 0.2.0 — `RUSTSEC-2022-0043`

- **Category**: file-disclosure (path traversal)
- **CWE**: CWE-22
- **Bug**: `ServeDir` on Windows accepted absolute paths like
  `/foo/bar/c:/windows/...` because the path-validity check was Unix-centric.
- **Fix**: 0.2.1 / 0.1.3.
- **Platform**: Windows only.
- **Scanner difficulty**: medium — the buggy code is straightforward path
  handling, but the *vulnerability condition* is platform-specific, so a
  scanner without OS-awareness may flag it as low-severity or miss it.
- **Advisory**: [`benchmarks/advisory-db/crates/tower-http/RUSTSEC-2022-0043.md`](advisory-db/crates/tower-http/RUSTSEC-2022-0043.md)

## Running a scan + evaluation

```bash
# 1. scan one CVE with any configured provider
npm run dev -- scan benchmarks/cves/memoffset-0.6.1 \
  --provider <provider> --report ./memoffset.json

# 2. score the report against ground truth
npm run eval -- ./memoffset.json \
  -g benchmarks/ground-truth/memoffset-0.6.1.yaml
```

### Running the whole corpus

```bash
mkdir -p reports
for d in benchmarks/cves/*/; do
  name=$(basename "$d")
  echo "=== Scanning $name ==="
  npm run dev -- scan "$d" --provider <provider> \
    --report "reports/$name.json"
done

echo "=== Aggregate scores ==="
for gt in benchmarks/ground-truth/*.yaml; do
  name=$(basename "$gt" .yaml)
  echo "--- $name ---"
  npm run eval -- "reports/$name.json" -g "$gt" 2>&1 \
    | grep -E "Recall|Precision"
done
```

## Suggested next steps

1. **Patched-version negative control**: also download the *patched* version
   of each crate. The scanner should find the bug in the vulnerable version
   and *not* find it in the patched one. Compute a precision number on the
   patched corpus.
2. **Expand**: `advisory-db/crates/` has ~825 entries. The current 6 are
   heavy on memory-corruption / path-traversal. Categories missing:
   concurrency / thread-safety, crypto-failure, logic bugs, command
   injection, format-injection.
3. **Stability**: run each scan 3–5× with the same model/provider and
   compute Jaccard similarity of finding sets. Single-shot recall is
   misleading if the scanner is non-deterministic.
