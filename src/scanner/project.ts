import { readFile, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { parse as parseToml } from "smol-toml";
import { globby } from "globby";

export interface Crate {
  name: string;
  rootDir: string;
  manifestPath: string;
}

export interface ProjectInfo {
  rootDir: string;
  projectName: string;
  isWorkspace: boolean;
  crates: Crate[];
}

interface CargoManifest {
  workspace?: {
    members?: string[];
    exclude?: string[];
  };
  package?: { name?: unknown };
}

export async function loadProject(dir: string): Promise<ProjectInfo> {
  const rootDir = resolve(dir);
  const rootManifest = join(rootDir, "Cargo.toml");
  try {
    await stat(rootManifest);
  } catch {
    throw new Error(`Not a Rust project: ${rootManifest} not found`);
  }
  const root = await readManifest(rootManifest);

  if (root.workspace) {
    const memberDirs = await expandMembers(rootDir, root.workspace.members ?? []);
    const excludeDirs = new Set(
      (root.workspace.exclude ?? []).map((p) => resolve(rootDir, p)),
    );

    const crates: Crate[] = [];
    // A workspace root may itself also be a crate ([workspace] + [package])
    const rootName = readPackageName(root);
    if (rootName) {
      crates.push({ name: rootName, rootDir, manifestPath: rootManifest });
    }

    for (const memberDir of memberDirs) {
      if (excludeDirs.has(memberDir)) continue;
      const manifestPath = join(memberDir, "Cargo.toml");
      try {
        await stat(manifestPath);
      } catch {
        continue;
      }
      try {
        const m = await readManifest(manifestPath);
        const name = readPackageName(m) ?? basename(memberDir);
        crates.push({ name, rootDir: memberDir, manifestPath });
      } catch {
        // skip unreadable member
      }
    }

    return {
      rootDir,
      projectName: rootName ?? basename(rootDir),
      isWorkspace: true,
      crates,
    };
  }

  // Single crate (non-workspace)
  const name = readPackageName(root) ?? basename(rootDir);
  return {
    rootDir,
    projectName: name,
    isWorkspace: false,
    crates: [{ name, rootDir, manifestPath: rootManifest }],
  };
}

async function readManifest(path: string): Promise<CargoManifest> {
  const content = await readFile(path, "utf8");
  return parseToml(content) as unknown as CargoManifest;
}

function readPackageName(m: CargoManifest): string | undefined {
  const n = m.package?.name;
  return typeof n === "string" ? n : undefined;
}

async function expandMembers(root: string, patterns: string[]): Promise<string[]> {
  const results: string[] = [];
  for (const pat of patterns) {
    if (pat.includes("*") || pat.includes("?") || pat.includes("[")) {
      const dirs = await globby(pat, {
        cwd: root,
        onlyDirectories: true,
        absolute: true,
      });
      results.push(...dirs);
    } else {
      results.push(resolve(root, pat));
    }
  }
  return results;
}
