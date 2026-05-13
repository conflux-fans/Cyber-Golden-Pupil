import { test } from "node:test";
import assert from "node:assert/strict";
import { chunkFileByAst } from "../src/scanner/ast.js";
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

test("ast: extracts a free function with a risk hint", () => {
  const file = makeFile(
    [
      "fn risky() {",
      "    let x: i64 = 1_000_000;",
      "    let y = x as i32;",
      "}",
    ].join("\n"),
  );
  const chunks = chunkFileByAst(file);
  assert.ok(chunks);
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0]!.startLine, 1);
  assert.equal(chunks[0]!.endLine, 4);
  assert.ok(chunks[0]!.hints.includes("cast"));
});

test("ast: gates out functions with no risk hint", () => {
  const file = makeFile("fn safe(x: i32) -> i32 { x + 1 }\n");
  const chunks = chunkFileByAst(file);
  assert.ok(chunks);
  assert.equal(chunks.length, 0);
});

test("ast: separates two top-level functions; gates the safe one", () => {
  const rust = [
    "fn safe() -> i32 { 42 }",
    "",
    "fn risky() {",
    "    unsafe { let _ = 1; }",
    "}",
  ].join("\n");
  const file = makeFile(rust);
  const chunks = chunkFileByAst(file);
  assert.ok(chunks);
  assert.equal(chunks.length, 1);
  assert.ok(chunks[0]!.content.includes("risky"));
});

test("ast: includes enclosing impl scope in chunk preamble", () => {
  const rust = [
    "impl Foo {",
    "    fn bar(&self) {",
    "        unsafe { *self.ptr = 1; }",
    "    }",
    "}",
  ].join("\n");
  const file = makeFile(rust);
  const chunks = chunkFileByAst(file);
  assert.ok(chunks);
  assert.equal(chunks.length, 1);
  // Chunk line numbers point at the real function in the file (not shifted by preamble).
  assert.equal(chunks[0]!.startLine, 2);
  assert.equal(chunks[0]!.endLine, 4);
  // Preamble exposes the enclosing scope to the LLM.
  assert.ok(chunks[0]!.content.includes("enclosing scope"));
  assert.ok(chunks[0]!.content.includes("impl Foo"));
});

test("ast: includes file-level `use` statements in preamble", () => {
  const rust = [
    "use std::mem;",
    "use std::ptr;",
    "",
    "fn risky() {",
    "    unsafe { mem::transmute::<u8, i8>(0); }",
    "}",
  ].join("\n");
  const file = makeFile(rust);
  const chunks = chunkFileByAst(file);
  assert.ok(chunks);
  assert.equal(chunks.length, 1);
  assert.ok(chunks[0]!.content.includes("file-level uses"));
  assert.ok(chunks[0]!.content.includes("use std::mem;"));
  assert.ok(chunks[0]!.content.includes("use std::ptr;"));
});

test("ast: extracts both methods inside an impl block", () => {
  const rust = [
    "impl Bar {",
    "    fn a(&self) { unsafe { *self.p = 1; } }",
    "    fn b(&self) { let _: i32 = (1u64) as i32; }",
    "}",
  ].join("\n");
  const file = makeFile(rust);
  const chunks = chunkFileByAst(file);
  assert.ok(chunks);
  assert.equal(chunks.length, 2);
  const names = chunks.map((c) => (c.content.match(/fn (\w+)/)?.[1] ?? "?"));
  assert.deepEqual(new Set(names), new Set(["a", "b"]));
});

test("ast: nested mod is reflected in container preamble", () => {
  const rust = [
    "mod inner {",
    "    fn risky() {",
    "        unsafe { let _ = 1; }",
    "    }",
    "}",
  ].join("\n");
  const file = makeFile(rust);
  const chunks = chunkFileByAst(file);
  assert.ok(chunks);
  assert.equal(chunks.length, 1);
  assert.ok(chunks[0]!.content.includes("mod inner"));
});
