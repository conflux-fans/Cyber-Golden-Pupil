import Parser from "tree-sitter";
import Rust from "tree-sitter-rust";
import type { Chunk, ScanMode, SourceFile } from "../types.js";
import { getRules } from "./rules.js";

/**
 * AST-driven function-level chunking using tree-sitter-rust.
 *
 * Strategy:
 *  1. Parse the file once with tree-sitter.
 *  2. Walk the tree and collect every "function-like" container —
 *     `function_item` (free fns, methods inside impl/trait, fns inside mod)
 *     plus `function_signature_item` inside `foreign_mod_item` (FFI extern blocks).
 *  3. For each function, evaluate the risk-hint regex set against its source range.
 *     Functions with zero hits are dropped — the regex set keeps acting as a cheap
 *     "is this worth an LLM call?" gate, just like the windowed prefilter.
 *  4. Build a chunk whose content is the function body plus a small contextual
 *     preamble: the file-level `use` statements and the enclosing impl/trait/mod
 *     signature line (so the LLM knows `Self`, the trait, etc.).
 *
 * This produces tighter, AST-correct chunks than the regex window strategy while
 * still gating on the same hint rules to control cost.
 */

// A lazily-constructed shared parser. tree-sitter parsers are not thread-safe,
// but Node is single-threaded so a singleton is fine.
let parser: Parser | null = null;
function getParser(): Parser {
  if (!parser) {
    parser = new Parser();
    parser.setLanguage(Rust as unknown as Parser.Language);
  }
  return parser;
}

const FUNCTION_NODE_TYPES = new Set([
  "function_item",
  // Trait method signatures and `extern "C" { fn ... }` declarations. These
  // have no body but are still worth scanning — `#[no_mangle]` exports and
  // FFI declarations live here.
  "function_signature_item",
]);

// Container nodes we record on the path to a function so we can build a
// "preamble" hint for the LLM ("this fn is inside `impl Foo for Bar`").
const CONTAINER_NODE_TYPES = new Set(["impl_item", "trait_item", "mod_item"]);

interface ExtractedFn {
  startLine: number; // 1-based, inclusive
  endLine: number; // 1-based, inclusive
  /** Stack of enclosing impl/trait/mod headers (signature line text). */
  containerHeaders: string[];
}

/**
 * Try AST-based chunking for a single file. Returns null if parsing fails so
 * the caller can fall back to regex-window chunking.
 */
export function chunkFileByAst(file: SourceFile, mode: ScanMode = "safety"): Chunk[] | null {
  let tree: Parser.Tree;
  try {
    tree = getParser().parse(file.content);
  } catch {
    return null;
  }
  if (!tree?.rootNode) return null;

  const lines = file.content.split("\n");
  const fns: ExtractedFn[] = [];
  collectFunctions(tree.rootNode, [], fns);

  // Detect the file-level `use` block so we can prepend it as context.
  // We grab leading `use` items at the top of the source_file node.
  const useLines = collectTopLevelUses(tree.rootNode, lines);

  const rules = getRules(mode);
  const chunks: Chunk[] = [];
  for (const fn of fns) {
    const startIdx = fn.startLine - 1;
    const endIdx = fn.endLine - 1;
    const body = lines.slice(startIdx, endIdx + 1).join("\n");

    // Gate: regex hint rules over the function body itself.
    const hintSet = new Set<string>();
    for (const r of rules) {
      if (r.re.test(body)) hintSet.add(r.hint);
    }
    if (hintSet.size === 0) continue;

    // Build the contextual preamble. We DO NOT shift line numbers — the chunk's
    // startLine/endLine still point at the real function in the file. The
    // preamble is purely advisory text shown to the LLM as part of `content`.
    const preambleParts: string[] = [];
    if (useLines.length > 0) {
      preambleParts.push("// --- file-level uses (context) ---");
      preambleParts.push(...useLines);
    }
    if (fn.containerHeaders.length > 0) {
      preambleParts.push("// --- enclosing scope (context) ---");
      preambleParts.push(...fn.containerHeaders.map((h) => `// ${h}`));
    }

    const content =
      preambleParts.length > 0
        ? `${preambleParts.join("\n")}\n// --- function body @ lines ${fn.startLine}-${fn.endLine} ---\n${body}`
        : body;

    chunks.push({
      file,
      startLine: fn.startLine,
      endLine: fn.endLine,
      content,
      hints: [...hintSet],
    });
  }

  return chunks;
}

/**
 * Recursively walk the AST and emit a record for each function-like node,
 * carrying along the stack of enclosing impl/trait/mod headers.
 */
function collectFunctions(
  node: Parser.SyntaxNode,
  containerStack: string[],
  out: ExtractedFn[],
): void {
  const isContainer = CONTAINER_NODE_TYPES.has(node.type);
  let nextStack = containerStack;
  if (isContainer) {
    nextStack = [...containerStack, headerLineOf(node)];
  }

  if (FUNCTION_NODE_TYPES.has(node.type)) {
    out.push({
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      containerHeaders: containerStack,
    });
    // Functions can technically contain nested fns (closures don't, but
    // `fn foo() { fn helper() {} }` does). Keep walking.
  }

  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child) collectFunctions(child, nextStack, out);
  }
}

/**
 * Returns the first source line of a node, trimmed. Used to summarize
 * `impl Foo for Bar` / `trait T` / `mod m` headers in the preamble.
 */
function headerLineOf(node: Parser.SyntaxNode): string {
  const text = node.text;
  const firstLine = text.split("\n", 1)[0] ?? "";
  // Strip trailing `{` so "impl Foo {" reads as "impl Foo".
  return firstLine.replace(/\s*\{?\s*$/, "").trim();
}

/**
 * Pull the contiguous block of top-level `use` items at the start of the file.
 * We stop at the first non-use, non-attribute item. This matches the common
 * Rust style of grouping imports at the top.
 */
function collectTopLevelUses(root: Parser.SyntaxNode, lines: string[]): string[] {
  const useLineSet = new Set<number>();
  for (let i = 0; i < root.childCount; i++) {
    const child = root.child(i);
    if (!child) continue;
    if (child.type === "use_declaration") {
      for (let r = child.startPosition.row; r <= child.endPosition.row; r++) {
        useLineSet.add(r);
      }
    } else if (
      child.type === "function_item" ||
      child.type === "impl_item" ||
      child.type === "trait_item" ||
      child.type === "mod_item" ||
      child.type === "struct_item" ||
      child.type === "enum_item"
    ) {
      // Hit a real definition — stop scanning for top-of-file uses.
      break;
    }
  }
  const indices = [...useLineSet].sort((a, b) => a - b);
  return indices.map((i) => lines[i] ?? "").filter((s) => s.length > 0);
}
