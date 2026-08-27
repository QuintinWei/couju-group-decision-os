import type { Choice, DecisionKind } from "./couju.ts";

export type RejectionReasonCode = "distance" | "price" | "category" | "place" | "other";
export type RejectionReason = { code: RejectionReasonCode; detail?: string };
export type RejectionReasonRecord = Record<string, RejectionReason>;

const COMMON = [
  { code: "distance", label: "太远" },
] as const;

export function rejectionReasonOptions(kind: DecisionKind) {
  return kind === "dining"
    ? [...COMMON, { code: "category", label: "不喜欢这个菜系" }, { code: "place", label: "只是这家不合适" }] as const
    : [...COMMON, { code: "category", label: "不喜欢这种活动" }, { code: "place", label: "只是这个地点不合适" }] as const;
}

export function feedbackWeight(choice: Choice, reason: RejectionReasonCode | null | undefined): number {
  if (choice === "like") return 2;
  if (choice === "okay") return 0.5;
  if (reason === "distance" || reason === "price" || reason === "place") return 0;
  if (reason === "category") return -1.5;
  return -0.5;
}

export function validateRejectionReasons(value: unknown, candidateIds: string[], choices: Record<string, Choice>): value is RejectionReasonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value === undefined || value === null;
  const ids = new Set(candidateIds);
  return Object.entries(value as Record<string, unknown>).every(([candidateId, raw]) => {
    if (!ids.has(candidateId) || choices[candidateId] !== "no" || !raw || typeof raw !== "object" || Array.isArray(raw)) return false;
    const reason = raw as { code?: unknown; detail?: unknown };
    if (!(reason.code === "distance" || reason.code === "price" || reason.code === "category" || reason.code === "place" || reason.code === "other")) return false;
    return reason.detail === undefined || (typeof reason.detail === "string" && reason.detail.trim().length <= 120);
  });
}

export function sanitizeRejectionReasons(value: RejectionReasonRecord, candidateIds: string[], choices: Record<string, Choice>): RejectionReasonRecord {
  const ids = new Set(candidateIds);
  return Object.fromEntries(Object.entries(value).filter(([candidateId]) => ids.has(candidateId) && choices[candidateId] === "no"));
}
