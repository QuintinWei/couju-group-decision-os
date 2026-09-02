import type { Candidate, Choice, DecisionKind, GroupMemberPreference, RoomConfig } from "./couju.ts";
import { COMMUTE_TOLERANCE_MINUTES, DEFAULT_INTERESTS } from "./couju.ts";
import { estimateTravelBetween, parseCommuteLimit } from "./couju.ts";
import { feedbackWeight } from "./rejection-feedback.ts";

export type RoundFeedback = {
  categoryScores: Map<string, number>;
  rejectedCandidateIds: string[];
  seenCandidateIds: string[];
};

type PrivateCategoryMember = {
  privateCandidates: Candidate[];
  nominatedCandidate: Candidate | null;
};

export type ConflictReasonType = "all_rejected" | "choice_rejection" | "commute" | "budget" | "duration" | "no_spicy" | "unknown_hard_fact";

export type ConflictReason = {
  type: ConflictReasonType;
  memberId?: string;
  candidateIds: string[];
  affectedCount: number;
  message: string;
};

export type CommuteRelaxationSuggestion = { memberId: string; memberName: string; currentMinutes: number; suggestedMinutes: number; addedMinutes: number; restoredCandidateCount: number };

type CommuteMember = {
  id: string;
  name?: string;
  commuteLabel?: string;
  originLocation?: { lng: number; lat: number } | null;
  choices?: Record<string, Choice>;
  budgetLabel?: string;
  setting?: string;
  extraction?: GroupMemberPreference["extraction"];
};

export function suggestMinimumCommuteRelaxation(candidates: Candidate[], members: CommuteMember[], config?: RoomConfig): CommuteRelaxationSuggestion | null {
  const suggestions = members.flatMap((member) => {
    const currentMinutes = parseCommuteLimit(member.commuteLabel ?? "不限");
    if (currentMinutes === null) return [];
    const over = candidates
      .filter((candidate) => candidateCanBeRestoredByCommute(candidate, member.id, currentMinutes, members, config))
      .map((candidate) => estimateTravelBetween(member.originLocation ?? null, candidate.location) ?? candidate.estimatedTravelMinutes)
      .filter((minutes): minutes is number => minutes !== null)
      .sort((a, b) => a - b);
    if (!over.length) return [];
    const suggestedMinutes = Math.max(currentMinutes + 1, Math.ceil(over[0] - COMMUTE_TOLERANCE_MINUTES));
    return [{ memberId: member.id, memberName: member.name || "某位成员", currentMinutes, suggestedMinutes, addedMinutes: suggestedMinutes - currentMinutes, restoredCandidateCount: over.filter((minutes) => minutes <= suggestedMinutes + COMMUTE_TOLERANCE_MINUTES).length }];
  });
  return suggestions.sort((a, b) => a.addedMinutes - b.addedMinutes || b.restoredCandidateCount - a.restoredCandidateCount)[0] ?? null;
}

function candidateCanBeRestoredByCommute(candidate: Candidate, affectedMemberId: string, currentMinutes: number, members: CommuteMember[], config?: RoomConfig) {
  const affected = members.find((member) => member.id === affectedMemberId);
  if (!affected) return false;
  const affectedTravel = estimateTravelBetween(affected.originLocation ?? null, candidate.location) ?? candidate.estimatedTravelMinutes;
  if (affectedTravel === null || affectedTravel <= currentMinutes + COMMUTE_TOLERANCE_MINUTES) return false;
  if (!config || members.some((member) => member.choices === undefined)) return true;
  if (candidate.priceValue === null) return false;

  for (const member of members) {
    if (member.choices?.[candidate.id] === "no") return false;
    const limits = [parseBudget(member.budgetLabel), numericConstraint(member as RoundMember, "max_budget")].filter((value): value is number => value !== null);
    if (limits.length && candidate.priceValue > Math.min(...limits)) return false;
    const start = Math.max(toMinutes(config.startTime), timeConstraint(member as RoundMember, "arrival_after") ?? 0);
    const end = Math.min(toMinutes(config.endTime), timeConstraint(member as RoundMember, "leave_before") ?? 24 * 60);
    if (candidate.durationMinutes > Math.max(0, end - start)) return false;
    if ((member.setting === "不吃辣" || hasConstraint(member as RoundMember, "no_spicy")) && candidate.features.nonSpicyAvailable === false) return false;
    if (member.id === affectedMemberId) continue;
    const commute = parseCommuteLimit(member.commuteLabel ?? "不限");
    const travel = estimateTravelBetween(member.originLocation ?? null, candidate.location) ?? candidate.estimatedTravelMinutes;
    if (commute !== null && travel !== null && travel > commute + COMMUTE_TOLERANCE_MINUTES) return false;
  }
  return true;
}

type RoundMember = Pick<GroupMemberPreference, "id" | "choices" | "submittedAt"> & Partial<Pick<GroupMemberPreference, "name" | "originLocation" | "budgetLabel" | "commuteLabel" | "setting" | "extraction" | "rejectionReasons">>;

export function canRequestPrivateDiscovery(candidateIds: string[], choices: Record<string, Choice>): boolean {
  return candidateIds.length === 12 && candidateIds.every((id) => choices[id] === "no");
}

export function aggregateRoundFeedback(candidates: Candidate[], members: RoundMember[]): RoundFeedback {
  const readyMembers = members.filter((member) => member.submittedAt !== null && member.submittedAt !== undefined);
  const categoryScores = new Map<string, number>();
  for (const candidate of candidates) {
    const score = readyMembers.reduce((total, member) => {
      const choice = member.choices[candidate.id];
      return total + (choice ? feedbackWeight(choice, member.rejectionReasons?.[candidate.id]?.code) : 0);
    }, 0);
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

export function aggregatePrivateCategoryPenalties(members: PrivateCategoryMember[]) {
  const penalties = new Map<string, number>();
  for (const member of members) {
    const nominatedKey = member.nominatedCandidate ? providerKey(member.nominatedCandidate) : null;
    for (const candidate of member.privateCandidates) {
      if (providerKey(candidate) === nominatedKey) continue;
      const category = candidate.matchedInterest || candidate.type;
      penalties.set(category, (penalties.get(category) ?? 0) - 1.5);
    }
  }
  return penalties;
}

export function applyCategoryPenalties(scores: Map<string, number>, penalties: Map<string, number>) {
  const combined = new Map(scores);
  for (const [category, penalty] of penalties) combined.set(category, (combined.get(category) ?? 0) + penalty);
  return combined;
}

export function selectQualifiedExploration(candidates: Candidate[], requestedUnseen: string[], seenCategories: Set<string>) {
  const requested = new Set(requestedUnseen);
  const selected: Candidate[] = [];
  const categories = new Set<string>();
  const providers = new Set<string>();
  for (const candidate of candidates) {
    const category = candidate.matchedInterest || candidate.type;
    const provider = providerKey(candidate);
    if (!requested.has(category) || seenCategories.has(category) || categories.has(category) || providers.has(provider)) continue;
    selected.push(candidate);
    categories.add(category);
    providers.add(provider);
    if (selected.length === 4) return selected;
  }
  throw new RoundCompositionError("insufficient_exploration", "下一轮未取得四张符合未探索类别的候选");
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
    if (!rejected.length) continue;
    const allRejected = rejected.length === candidates.length;
    reasons.push({
      type: allRejected ? "all_rejected" : "choice_rejection",
      memberId: member.id,
      candidateIds: rejected,
      affectedCount: rejected.length,
      message: allRejected
        ? `${memberDisplayName(member)} 拒绝了本轮全部候选`
        : `${memberDisplayName(member)} 的选择排除了 ${rejected.length}/${candidates.length} 张候选`,
    });
  }

  const reasonChecks: Array<{ type: Exclude<ConflictReasonType, "all_rejected" | "choice_rejection" | "unknown_hard_fact">; matches: (candidate: Candidate, member: RoundMember) => boolean; message: (member: RoundMember, count: number) => string }> = [
    { type: "commute", matches: (candidate, member) => {
      const limit = parseCommuteLimit(member.commuteLabel ?? "不限");
      if (limit === null) return false;
      const travel = estimateTravelBetween(member.originLocation ?? null, candidate.location) ?? candidate.estimatedTravelMinutes;
      return travel !== null && travel > limit;
    }, message: (member, count) => `${memberDisplayName(member)} 的通勤上限影响了 ${count}/${candidates.length} 张候选` },
    { type: "budget", matches: (candidate, member) => {
      const limits = [parseBudget(member.budgetLabel), numericConstraint(member, "max_budget")].filter((value): value is number => value !== null);
      if (!limits.length || candidate.priceValue === null) return false;
      return candidate.priceValue > Math.min(...limits);
    }, message: (member, count) => `${memberDisplayName(member)} 的预算上限影响了 ${count}/${candidates.length} 张候选` },
    { type: "duration", matches: (candidate, member) => {
      const start = Math.max(toMinutes(config.startTime), timeConstraint(member, "arrival_after") ?? 0);
      const end = Math.min(toMinutes(config.endTime), timeConstraint(member, "leave_before") ?? 24 * 60);
      return candidate.durationMinutes > Math.max(0, end - start);
    }, message: (member, count) => `${memberDisplayName(member)} 的可用时间影响了 ${count}/${candidates.length} 张候选` },
    { type: "no_spicy", matches: (candidate, member) => {
      const noSpicy = member.setting === "不吃辣" || hasConstraint(member, "no_spicy");
      return noSpicy && candidate.features.nonSpicyAvailable === false;
    }, message: (member, count) => `${memberDisplayName(member)} 的不吃辣约束影响了 ${count}/${candidates.length} 张候选` },
  ];

  for (const check of reasonChecks) {
    for (const member of readyMembers) {
      const ids = allCandidates(candidates, (candidate) => check.matches(candidate, member));
      if (ids.length) reasons.push({ type: check.type, memberId: member.id, candidateIds: ids, affectedCount: ids.length, message: check.message(member, ids.length) });
    }
  }

  const unknownIds = allCandidates(candidates, (candidate) => readyMembers.some((member) => {
    const budgetKnown = parseBudget(member.budgetLabel) !== null || numericConstraint(member, "max_budget") !== null;
    const commuteKnown = parseCommuteLimit(member.commuteLabel ?? "不限") !== null;
    const noSpicy = member.setting === "不吃辣" || hasConstraint(member, "no_spicy");
    const travel = estimateTravelBetween(member.originLocation ?? null, candidate.location) ?? candidate.estimatedTravelMinutes;
    return (budgetKnown && candidate.priceValue === null) || (commuteKnown && travel === null) || (noSpicy && candidate.features.nonSpicyAvailable === null) || hasConstraint(member, "allergy");
  }));
  if (unknownIds.length) reasons.push({ type: "unknown_hard_fact", candidateIds: unknownIds, affectedCount: unknownIds.length, message: `有 ${unknownIds.length}/${candidates.length} 张候选缺少可核验地点事实` });
  return reasons.sort(compareConflictImpact);
}

const CONFLICT_TIE_ORDER: ConflictReasonType[] = ["all_rejected", "choice_rejection", "commute", "budget", "duration", "no_spicy", "unknown_hard_fact"];

function compareConflictImpact(left: ConflictReason, right: ConflictReason) {
  return right.affectedCount - left.affectedCount
    || CONFLICT_TIE_ORDER.indexOf(left.type) - CONFLICT_TIE_ORDER.indexOf(right.type)
    || (left.memberId ?? "").localeCompare(right.memberId ?? "")
    || left.candidateIds.join(",").localeCompare(right.candidateIds.join(","));
}

function memberDisplayName(member: RoundMember) {
  return member.name?.trim() || "一位成员";
}

function toMinutes(value: string): number {
  const [hour, minute] = value.split(":").map(Number);
  return Number.isFinite(hour) && Number.isFinite(minute) ? hour * 60 + minute : 0;
}
