import { readFile } from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import type { GroundTruth } from "./types.js";

const SeveritySchema = z.enum(["critical", "high", "medium", "low", "info"]);

const EntrySchema = z.object({
  id: z.string().min(1),
  file: z.string().min(1),
  line_start: z.number().int().positive(),
  line_end: z.number().int().positive(),
  category: z.string().min(1),
  cwe: z.string().optional(),
  severity: SeveritySchema,
  must_detect: z.boolean(),
  aliases: z.array(z.string()).default([]),
  notes: z.string().optional(),
});

const GroundTruthSchema = z.object({
  target: z.string().min(1),
  schema_version: z.number().int().positive(),
  match_policy: z.object({
    line_slack: z.number().int().nonnegative(),
    severity_order: z.array(SeveritySchema).length(5),
  }),
  findings: z.array(EntrySchema),
});

export async function loadGroundTruth(path: string): Promise<GroundTruth> {
  const raw = await readFile(path, "utf8");
  const doc = parseYaml(raw);
  const parsed = GroundTruthSchema.safeParse(doc);
  if (!parsed.success) {
    throw new Error(
      `Invalid ground truth at ${path}: ${parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ")}`,
    );
  }
  // Cross-field invariants the zod schema cannot express alone.
  const seen = new Set<string>();
  for (const f of parsed.data.findings) {
    if (seen.has(f.id)) {
      throw new Error(`Duplicate ground-truth id "${f.id}" in ${path}`);
    }
    seen.add(f.id);
    if (f.line_end < f.line_start) {
      throw new Error(
        `Ground-truth ${f.id}: line_end (${f.line_end}) < line_start (${f.line_start})`,
      );
    }
  }
  return parsed.data;
}
