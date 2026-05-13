import { test } from "node:test";
import assert from "node:assert/strict";
import { prefilter } from "../src/scanner/prefilter.js";
import type { SourceFile } from "../src/types.js";

function makeFile(content: string, relPath = "src/lib.rs"): SourceFile {
  return {
    absPath: `/project/${relPath}`,
    relPath,
    content,
    language: "rust",
    crate: "test-crate",
  };
}

test("prefilter: files with no risk hints produce no chunks (all modes)", () => {
  const file = makeFile("fn safe() -> i32 { 42 }\n");
  for (const unit of ["file", "function", "ast-function"] as const) {
    assert.deepEqual(prefilter([file], unit), [], `mode=${unit}`);
  }
});

test("prefilter [file]: one chunk per file, hints aggregated", () => {
  const content = [
    "fn risky() {",
    "    unsafe { let _ = std::mem::transmute::<u8, i8>(0); }",
    "    let x: i64 = 1_000_000;",
    "    let y = x as i32;",
    "}",
  ].join("\n");
  const file = makeFile(content);
  const chunks = prefilter([file], "file");
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0]!.startLine, 1);
  assert.equal(chunks[0]!.endLine, 5);
  // Should contain multiple hints
  assert.ok(chunks[0]!.hints.includes("unsafe"));
  assert.ok(chunks[0]!.hints.includes("transmute"));
  assert.ok(chunks[0]!.hints.includes("cast"));
});

test("prefilter [function/window]: single hit produces a window with leading context", () => {
  // 30 lines, hit on 0-indexed line 14.
  const lines = Array.from({ length: 30 }, (_, i) =>
    i === 14 ? "    unsafe { *p = 1; }" : `    let x${i} = ${i};`,
  );
  const file = makeFile(lines.join("\n"));
  const chunks = prefilter([file], "function");
  assert.equal(chunks.length, 1);
  // CONTEXT_BEFORE = 10 → window starts at line 5 (1-indexed: 15 - 10).
  assert.equal(chunks[0]!.startLine, 5);
  assert.ok(chunks[0]!.hints.includes("unsafe"));
});

test("prefilter [function/window]: adjacent hits merge into one chunk", () => {
  // Two unsafe hits within window distance (10 lines apart).
  const lines = Array.from({ length: 100 }, (_, i) => {
    if (i === 20) return "    unsafe { *p1 = 1; }";
    if (i === 30) return "    unsafe { *p2 = 2; }";
    return `    let x${i} = ${i};`;
  });
  const file = makeFile(lines.join("\n"));
  const chunks = prefilter([file], "function");
  // hit 20 window=[10,100], hit 30 window=[20,110] — overlap → merge.
  assert.equal(chunks.length, 1);
});

test("prefilter [function/window]: far-apart hits produce separate chunks", () => {
  // Hits 200 lines apart — well beyond WINDOW_AFTER (80).
  const lines = Array.from({ length: 300 }, (_, i) => {
    if (i === 20) return "    unsafe { *p1 = 1; }";
    if (i === 250) return "    unsafe { *p2 = 2; }";
    return `    let x${i} = ${i};`;
  });
  const file = makeFile(lines.join("\n"));
  const chunks = prefilter([file], "function");
  assert.equal(chunks.length, 2);
});

test("prefilter [ast-function]: only flags functions whose body has a risk hint", () => {
  const rust = [
    "fn safe_helper(x: i32) -> i32 {",
    "    x + 1",
    "}",
    "",
    "fn risky() {",
    "    unsafe { let _ = std::mem::transmute::<u8, i8>(0); }",
    "}",
  ].join("\n");
  const file = makeFile(rust);
  const chunks = prefilter([file], "ast-function");
  assert.equal(chunks.length, 1);
  assert.ok(chunks[0]!.content.includes("risky"));
  assert.ok(chunks[0]!.hints.includes("unsafe"));
  assert.ok(chunks[0]!.hints.includes("transmute"));
});

test("prefilter: multiple rule categories detected", () => {
  const rust = [
    "fn touches_many_things() {",
    "    let _ = std::fs::read_to_string(\"x\").unwrap();",
    "    let _ = std::process::Command::new(\"ls\").spawn();",
    "    let _: i32 = (1_u64) as i32;",
    "}",
  ].join("\n");
  const file = makeFile(rust);
  const chunks = prefilter([file], "file");
  assert.equal(chunks.length, 1);
  const hints = new Set(chunks[0]!.hints);
  assert.ok(hints.has("fs"));
  assert.ok(hints.has("process"));
  assert.ok(hints.has("panic")); // .unwrap()
  assert.ok(hints.has("cast"));
});
