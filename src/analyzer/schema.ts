import { z } from "zod";

export const FindingSchema = z.object({
  rule_id: z.string(),
  severity: z.enum(["critical", "high", "medium", "low", "info"]),
  cwe: z.string().optional(),
  file: z.string(),
  line_start: z.number().int().nonnegative(),
  line_end: z.number().int().nonnegative(),
  summary: z.string(),
  evidence: z.string(),
  fix_suggestion: z.string(),
  confidence: z.number().min(0).max(1),
});

export const AnalysisResponseSchema = z.object({
  findings: z.array(FindingSchema),
});

export type AnalysisResponse = z.infer<typeof AnalysisResponseSchema>;
