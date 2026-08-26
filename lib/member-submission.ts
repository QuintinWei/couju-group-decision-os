import type { Choice } from "./couju.ts";
import { validateRejectionReasons } from "./rejection-feedback.ts";

export type SubmissionValidationResult =
  | { ok: true }
  | { ok: false; code: "MALFORMED" | "STALE_ROUND" | "INVALID_SHARED_CANDIDATES" | "INVALID_CHOICES" };

export function validateMemberSubmission(input: {
  expectedRound: unknown;
  currentRound: number;
  candidateIds: string[];
  choices: unknown;
  rejectionReasons?: unknown;
}): SubmissionValidationResult {
  if (typeof input.expectedRound !== "number" || !Number.isInteger(input.expectedRound) || input.expectedRound < 1 || input.expectedRound > 3) {
    return { ok: false, code: "MALFORMED" };
  }
  if (input.expectedRound !== input.currentRound) return { ok: false, code: "STALE_ROUND" };
  if (input.candidateIds.length !== 12 || new Set(input.candidateIds).size !== 12) return { ok: false, code: "INVALID_SHARED_CANDIDATES" };
  if (!input.choices || typeof input.choices !== "object" || Array.isArray(input.choices)) return { ok: false, code: "INVALID_CHOICES" };
  const entries = Object.entries(input.choices as Record<string, unknown>);
  const expected = new Set(input.candidateIds);
  if (entries.length !== 12 || entries.some(([id, value]) => !expected.has(id) || (value !== "like" && value !== "okay" && value !== "no"))) {
    return { ok: false, code: "INVALID_CHOICES" };
  }
  if (!validateRejectionReasons(input.rejectionReasons, input.candidateIds, input.choices as Record<string, Choice>)) return { ok: false, code: "INVALID_CHOICES" };
  return { ok: true };
}

export function isChoiceRecord(value: unknown): value is Record<string, Choice> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value)
    && Object.values(value as Record<string, unknown>).every((choice) => choice === "like" || choice === "okay" || choice === "no"));
}
