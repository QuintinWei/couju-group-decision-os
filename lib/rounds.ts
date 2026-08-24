import type { Candidate, Choice, DecisionKind, GroupMemberPreference, RoomConfig } from "./couju.ts";
import { DEFAULT_INTERESTS } from "./couju.ts";
import { estimateTravelBetween, parseCommuteLimit } from "./couju.ts";

export type RoundFeedback = {
  categoryScores: Map<string, number>;
  rejectedCandidateIds: string[];
  seenCandidateIds: string[];
};

export type ConflictReasonType = "all_rejected" | "commute" | "budget" | "duration" | "no_spicy" | "unknown_hard_fact";

export type ConflictReason = {
  type: ConflictReasonType;
  memberId?: string;
  candidateIds: string[];
  message: string;
};

const CHOICE_WEIGHT: Record<Choice, number> = { like: 2, okay: 0.5, no: -1.5 };

type RoundMember = Pick<GroupMemberPreference, "id" | "choices" | "submittedAt"> & Partial<Pick<GroupMemberPreference, "originLocation" | "budgetLabel" | "commuteLabel" | "setting" | "extraction">>;

export function canRequestPrivateDiscovery(candidateIds: string[], choices: Record<string, Choice>): boolean {
  return candidateIds.length === 12 && candidateIds.every((id) => choices[id] === "no");
}

export function aggregateRoundFeedback(candidates: Candidate[], members: RoundMember[]): RoundFeedback {
  const readyMembers = members.filter((member) => member.submittedAt !== null && member.submittedAt !== undefined);
  const categoryScores = new Map<string, number>();
  for (const candidate of candidates) {
    const score = readyMembers.reduce((total, member) => total + (member.choices[candidate.id] ? CHOICE_WEIGHT[member.choices[candidate.id]] : 0), 0);
    const category = candidate.matchedInterest || candidate.type;
    categoryScores.set(category, (categoryScores.get(category) ?? 0) + score);
  }
  const rejectedCandidateIds = candidates
    .filter((candidate) => readyMembers.length > 0 && readyMembers.every((member) => member.choices[candidate.id] === "no"))
    .map((candidate) => candidate.id);
  return { categoryScores, rejectedCandidateIds, seenCandidateIds: candidates.map((candidate) => candidate.id) };
}

/** Convert persisted stable category keys into the selectable vocabulary for the next learn query. */
export function normalizeFeedbackInterestScores(kind: DecisionKind, categoryScores: Map<string, number>) {
  const scores = new Map<string, number>();
  for (const [feedbackCategory, score] of categoryScores) {
    const category = DEFAULT_INTERESTS[kind].find((interest) => interest === feedbackCategory || feedbackCategory.includes(interest) || interest.includes(feedbackCategory));
    if (!category) continue;
    scores.set(category, (scores.get(category) ?? 0) + score);
  }
  return scores;
}

function providerKey(candidate: Candidate): string {
  return candidate.source.providerId || candidate.id;
}

function addUnique(target: Candidate[], candidates: Candidate[], used: Set<string>, segment: NonNullable<Candidate["segment"]>, limit: number) {
  for (const candidate of candidates) {
    if (target.length >= limit) break;
    const key = providerKey(candidate);
    if (used.has(key)) continue;
    used.add(key);
    target.push({ ...candidate, segment });
  }
}

export function buildNextRoundSlots(nominations: Candidate[], learned: Candidate[], exploration: Candidate[]): Candidate[] {
  const explorationKeys = new Set<string>();
  for (const candidate of exploration) {
    const key = providerKey(candidate);
    if (nominations.some((nomination) => providerKey(nomination) === key)) continue;
    explorationKeys.add(key);
  }
  if (explorationKeys.size < 4) throw new RoundCompositionError("insufficient_exploration", "下一轮至少需要四张未重复的探索卡");

  const result: Candidate[] = [];
  const used = new Set<string>();
  addUnique(result, nominations, used, "nomination", 8);
  addUnique(result, learned, used, "learned", 8);
  if (result.length < 8) throw new RoundCompositionError("insufficient_unique_candidates", "候选池无法提供八张提名或反馈学习卡");
  addUnique(result, exploration.filter((candidate) => !used.has(providerKey(candidate))), used, "explore", 12);
  if (result.length !== 12 || result.filter((candidate) => candidate.segment === "explore").length !== 4) {
    throw new RoundCompositionError("insufficient_unique_candidates", "候选池无法组成十二张且保留四张探索卡");
  }
  return result;
}

export class RoundCompositionError extends Error {
  readonly code: "insufficient_exploration" | "insufficient_unique_candidates";

  constructor(code: "insufficient_exploration" | "insufficient_unique_candidates", message: string) {
    super(message);
    this.name = "RoundCompositionError";
    this.code = code;
  }
}

function numericConstraint(member: RoundMember, type: string): number | null {
  const value = member.extraction?.hardConstraints.find((item) => item.type === type)?.value;
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function timeConstraint(member: RoundMember, type: string): number | null {
  const value = member.extraction?.hardConstraints.find((item) => item.type === type)?.value;
  if (!value) return null;
  const [hour, minute] = value.split(":").map(Number);
  return Number.isFinite(hour) && Number.isFinite(minute) ? hour * 60 + minute : null;
}

function hasConstraint(member: RoundMember, type: string): boolean {
  return Boolean(member.extraction?.hardConstraints.some((item) => item.type === type));
}

function parseBudget(label = "不限"): number | null {
  if (/不限/.test(label)) return null;
  const match = label.match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function allCandidates(candidates: Candidate[], predicate: (candidate: Candidate) => boolean): string[] {
  return candidates.filter(predicate).map((candidate) => candidate.id);
}

export function diagnoseRoundConflict(candidates: Candidate[], members: RoundMember[], config: RoomConfig): ConflictReason[] {
  const readyMembers = members.filter((member) => member.submittedAt !== null && member.submittedAt !== undefined);
  const reasons: ConflictReason[] = [];
  if (!candidates.length || readyMembers.length === 0) return reasons;

  for (const member of readyMembers) {
    const rejected = allCandidates(candidates, (candidate) => member.choices[candidate.id] === "no");
    if (rejected.length === candidates.length) {
      reasons.push({ type: "all_rejected", memberId: member.id, candidateIds: rejected, message: `${member.id} 拒绝了本轮全部候选` });
      break;
    }
  }

  const reasonChecks: Array<{ type: ConflictReasonType; matches: (candidate: Candidate, member: RoundMember) => boolean; message: (member: RoundMember) => string }> = [
    { type: "commute", matches: (candidate, member) => {
      const limit = parseCommuteLimit(member.commuteLabel ?? "不限");
      if (limit === null) return false;
      const travel = estimateTravelBetween(member.originLocation ?? null, candidate.location) ?? candidate.estimatedTravelMinutes;
      return travel !== null && travel > limit;
    }, message: (member) => `${member.id} 的通勤上限排除了全部候选` },
    { type: "budget", matches: (candidate, member) => {
      const limits = [parseBudget(member.budgetLabel), numericConstraint(member, "max_budget")].filter((value): value is number => value !== null);
      if (!limits.length || candidate.priceValue === null) return false;
      return candidate.priceValue > Math.min(...limits);
    }, message: (member) => `${member.id} 的预算上限排除了全部已知价格候选` },
    { type: "duration", matches: (candidate, member) => {
      const start = Math.max(toMinutes(config.startTime), timeConstraint(member, "arrival_after") ?? 0);
      const end = Math.min(toMinutes(config.endTime), timeConstraint(member, "leave_before") ?? 24 * 60);
      return candidate.durationMinutes > Math.max(0, end - start);
    }, message: (member) => `${member.id} 的可用时间短于全部候选建议时长` },
    { type: "no_spicy", matches: (candidate, member) => {
      const noSpicy = member.setting === "不吃辣" || hasConstraint(member, "no_spicy");
      return noSpicy && candidate.features.nonSpicyAvailable === false;
    }, message: (member) => `${member.id} 的不吃辣约束排除了全部候选` },
  ];

  for (const check of reasonChecks) {
    for (const member of readyMembers) {
      const ids = allCandidates(candidates, (candidate) => check.matches(candidate, member));
      if (ids.length === candidates.length) {
        reasons.push({ type: check.type, memberId: member.id, candidateIds: ids, message: check.message(member) });
        break;
      }
    }
  }

  const unknownIds = allCandidates(candidates, (candidate) => readyMembers.some((member) => {
    const budgetKnown = parseBudget(member.budgetLabel) !== null || numericConstraint(member, "max_budget") !== null;
    const commuteKnown = parseCommuteLimit(member.commuteLabel ?? "不限") !== null;
    const noSpicy = member.setting === "不吃辣" || hasConstraint(member, "no_spicy");
    const travel = estimateTravelBetween(member.originLocation ?? null, candidate.location) ?? candidate.estimatedTravelMinutes;
    return (budgetKnown && candidate.priceValue === null) || (commuteKnown && travel === null) || (noSpicy && candidate.features.nonSpicyAvailable === null) || hasConstraint(member, "allergy");
  }));
  if (unknownIds.length) reasons.push({ type: "unknown_hard_fact", candidateIds: unknownIds, message: "部分硬约束缺少可核验地点事实，无法确认全部候选" });
  return reasons;
}

function toMinutes(value: string): number {
  const [hour, minute] = value.split(":").map(Number);
  return Number.isFinite(hour) && Number.isFinite(minute) ? hour * 60 + minute : 0;
}
