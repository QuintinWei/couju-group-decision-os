import type { Candidate, Choice, DecisionKind, RejectionReason } from "../types/api.ts";

export type SwipeState<R = RejectionReason> = {
  choices: Record<string, Choice>;
  reasons: Record<string, R>;
};

export type RejectionOption = {
  key: string;
  label: string;
  reason: RejectionReason;
};

type CandidateFactSource = Pick<Candidate, "city" | "district" | "address" | "priceValue" | "priceLabel" | "estimatedTravelMinutes">;

export function candidateDisplayFacts(candidate: CandidateFactSource) {
  const location = candidate.district || candidate.address || candidate.city;
  const price = candidate.priceValue === null ? "价格待确认" : candidate.priceLabel || `人均 ¥${candidate.priceValue}`;
  const commute = candidate.estimatedTravelMinutes === null ? "通勤待确认" : `预计通勤 ${candidate.estimatedTravelMinutes} 分钟`;
  return [location, price, commute];
}

export function candidateImageUrl(path: string, apiBase: string | undefined) {
  if (/^https?:\/\//i.test(path)) return path;
  const base = apiBase?.trim().replace(/\/+$/, "") ?? "";
  return base && path.startsWith("/") ? `${base}${path}` : path;
}

export function canSubmitSharedRound(candidateIds: string[], choices: Record<string, unknown>) {
  if (candidateIds.length !== 12 || new Set(candidateIds).size !== 12) return false;
  const entries = Object.entries(choices);
  const currentIds = new Set(candidateIds);
  return entries.length === 12 && entries.every(([candidateId, choice]) => (
    currentIds.has(candidateId) && (choice === "no" || choice === "okay" || choice === "like")
  ));
}

export function recordChoice<R>(state: SwipeState<R>, candidateId: string, choice: Choice, reason?: R): SwipeState<R> {
  const reasons = { ...state.reasons };
  if (choice !== "no" || reason === undefined) delete reasons[candidateId];
  else reasons[candidateId] = reason;
  return { choices: { ...state.choices, [candidateId]: choice }, reasons };
}

export function rejectionReasonOptions(kind: DecisionKind): RejectionOption[] {
  if (kind === "dining") {
    return [
      { key: "queue", label: "排队太久", reason: { code: "place", detail: "排队" } },
      { key: "category", label: "不喜欢这个口味 / 菜系", reason: { code: "category" } },
      { key: "environment", label: "环境不合适", reason: { code: "place", detail: "环境" } },
      { key: "distance", label: "距离太远", reason: { code: "distance" } },
    ];
  }
  return [
    { key: "intensity", label: "活动强度不合适", reason: { code: "other", detail: "活动强度" } },
    { key: "category", label: "对这种活动没兴趣", reason: { code: "category" } },
    { key: "environment", label: "环境不合适", reason: { code: "place", detail: "环境" } },
    { key: "distance", label: "距离太远", reason: { code: "distance" } },
  ];
}

export function createSubmissionGate() {
  let active: Promise<unknown> | null = null;
  return {
    run<T>(task: () => Promise<T>): Promise<T> {
      if (active) return active as Promise<T>;
      let attempt: Promise<T>;
      try { attempt = task(); }
      catch (error) { attempt = Promise.reject(error); }
      active = attempt.then(
        (value) => value,
        (error) => { active = null; throw error; },
      );
      return active as Promise<T>;
    },
  };
}

export async function submitWithRoundRecovery(input: { submit: () => Promise<unknown>; reload: () => Promise<unknown> }) {
  try {
    await input.submit();
    return { kind: "submitted" as const };
  } catch (error) {
    if (isStatus(error, 409)) {
      await input.reload();
      return { kind: "stale" as const };
    }
    throw error;
  }
}

function isStatus(error: unknown, status: number) {
  return Boolean(error && typeof error === "object" && "status" in error && error.status === status);
}
