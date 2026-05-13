import type { Finding } from "../types.js";

export function renderJson(findings: Finding[]): string {
  return JSON.stringify(
    { findings, generated_at: new Date().toISOString() },
    null,
    2,
  );
}
