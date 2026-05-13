import { globby } from "globby";
import { readFile } from "node:fs/promises";
import { relative } from "node:path";
import type { SourceFile } from "../types.js";
import type { Crate } from "./project.js";

const RUST_GLOBS = ["**/*.rs"];
const IGNORE = ["target/**", "**/target/**", "node_modules/**"];

/**
 * Walk all .rs files belonging to the given crates.
 *
 * When workspaces have nested members, a file lives under both the workspace
 * root dir and the member dir. Longer (more specific) crate paths claim files
 * first, so each file is attributed to its innermost crate.
 */
export async function walkCrates(
  projectRoot: string,
  crates: Crate[],
  maxFiles?: number,
): Promise<SourceFile[]> {
  const sorted = [...crates].sort((a, b) => b.rootDir.length - a.rootDir.length);
  const owner = new Map<string, string>(); // absPath -> crate name

  for (const crate of sorted) {
    const paths = await globby(RUST_GLOBS, {
      cwd: crate.rootDir,
      gitignore: true,
      ignore: IGNORE,
      absolute: true,
    });
    for (const p of paths) {
      if (!owner.has(p)) owner.set(p, crate.name);
    }
  }

  const entries = [...owner.entries()];
  const sliced = maxFiles ? entries.slice(0, maxFiles) : entries;
  return await Promise.all(
    sliced.map(async ([absPath, crateName]) => ({
      absPath,
      relPath: relative(projectRoot, absPath),
      content: await readFile(absPath, "utf8"),
      language: "rust" as const,
      crate: crateName,
    })),
  );
}
