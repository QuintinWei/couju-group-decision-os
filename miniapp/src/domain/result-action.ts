import type { Candidate, Choice, DecisionKind, ParticipantRoom } from "../types/api.ts";

const commuteToleranceMinutes = 15;
const uncertaintyPenaltyWeight = 0.35;

export type ResultAction = "result" | "wait" | "private-discovery" | "advance" | "edit-commute";

export type ParticipantRanking = Candidate & {
  groupFit: number;
  minUtility: number;
  meanUtility: number;
  geoMean: number;
  evidence: string[];
  explanation: string;
  memberUtilities: Array<{ memberId: string; name: string; utility: number; travelMinutes: number | null }>;
  meanTravelMinutes: number | null;
  onParetoFrontier: boolean;
};

export type ParticipantConflict = {
  type: "all_rejected" | "choice_rejection" | "commute" | "budget" | "duration" | "no_spicy" | "unknown_hard_fact";
  memberId?: string;
  affectedCount: number;
  message: string;
};

export type ParticipantCommuteRelaxation = {
  memberId: string;
  memberName: string;
  currentMinutes: number;
  suggestedMinutes: number;
  addedMinutes: number;
  restoredCandidateCount: number;
};

export function resultAction(room: ParticipantRoom, memberId: string): ResultAction {
  if (!isCompletedParticipantRound(room)) return "wait";
  if (participantRankings(room).length > 0) return "result";

  const member = room.members.find((item) => item.id === memberId);
  if (!member) return "wait";
  if (room.currentRound < 3) {
    const recovered = member.refreshRequestRound === room.currentRound;
    const hasCompletePrivateBatch = (member.privateCandidates?.length ?? 0) === 3;
    if (canOpenPrivateDiscovery(room, memberId) && (!recovered || !hasCompletePrivateBatch)) return "private-discovery";
    if (advancePermitted(room)) return room.members[0]?.id === memberId ? "advance" : "wait";
    return "wait";
  }

  const commute = suggestParticipantCommuteRelaxation(room);
  if (commute) return commute.memberId === memberId ? "edit-commute" : "wait";
  return "wait";
}

export function participantRankings(room: ParticipantRoom): ParticipantRanking[] {
  if (!isCompletedParticipantRound(room)) return [];
  const readyMembers = room.members.filter((member) => Boolean(member.submittedAt));
  const scored = room.candidates.flatMap((candidate) => {
    if (candidate.priceValue === null) return [];
    const contexts = readyMembers.map((member) => {
      const budget = mergeLimit(parseLabelNumber(member.budgetLabel), extractionNumber(member.extraction, "max_budget"));
      const commute = parseCommuteLimit(member.commuteLabel);
      const start = Math.max(toMinutes(room.config.startTime), extractionTime(member.extraction, "arrival_after") ?? 0);
      const end = Math.min(toMinutes(room.config.endTime), extractionTime(member.extraction, "leave_before") ?? 24 * 60);
      const travelMinutes = estimateTravelBetween(member.originLocation, candidate.location) ?? candidate.estimatedTravelMinutes;
      return {
        member,
        budget,
        commute,
        travelMinutes,
        availableMinutes: Math.max(0, end - start),
        noSpicy: member.setting === "不吃辣" || hasExtractionConstraint(member.extraction, "no_spicy"),
      };
    });

    if (contexts.some(({ member, budget, commute, travelMinutes, availableMinutes, noSpicy }) =>
      member.choices[candidate.id] === "no"
      || (budget !== null && candidate.priceValue! > budget)
      || (commute !== null && travelMinutes !== null && travelMinutes > commute + commuteToleranceMinutes)
      || candidate.durationMinutes > availableMinutes
      || (noSpicy && candidate.features.nonSpicyAvailable === false)
    )) return [];

    const unknownFacts: string[] = [];
    if (contexts.some(({ commute }) => commute !== null) && candidate.estimatedTravelMinutes === null) unknownFacts.push("通勤时间");
    if (contexts.some(({ noSpicy }) => noSpicy) && candidate.features.nonSpicyAvailable === null) unknownFacts.push("不辣选项");
    if (candidate.source.mode === "live" && !candidate.openToday) unknownFacts.push("营业时间");
    if (contexts.some(({ member }) => hasExtractionConstraint(member.extraction, "allergy"))) unknownFacts.push("过敏原");

    const memberUtilities = contexts.map(({ member, budget, commute, travelMinutes }) => ({
      memberId: member.id,
      name: member.name,
      travelMinutes,
      utility: scoreMember(candidate, member.choices[candidate.id], member.setting, member.extraction, budget, commute, travelMinutes),
    }));
    const utilities = memberUtilities.map((item) => item.utility);
    const minUtility = Math.min(...utilities);
    const meanUtility = utilities.reduce((sum, value) => sum + value, 0) / utilities.length;
    const geoMean = Math.exp(utilities.reduce((sum, value) => sum + Math.log(Math.max(value, 0.01)), 0) / utilities.length);
    const uncertainty = clamp((candidate.source.mode === "demo" ? 0.08 : 0) + unknownFacts.length * 0.055, 0, 0.32);
    const raw = minUtility >= 0.6
      ? 0.35 * minUtility + 0.55 * geoMean + 0.1 * meanUtility - uncertaintyPenaltyWeight * uncertainty
      : 0.65 * minUtility + 0.25 * geoMean + 0.1 * meanUtility - uncertaintyPenaltyWeight * uncertainty;
    const roundedMemberUtilities = memberUtilities.map((item) => ({ ...item, utility: Math.round(item.utility * 100) }));
    const evidence = [
      `${contexts.filter(({ member }) => member.choices[candidate.id] === "like").length}/${readyMembers.length} 位成员明确喜欢`,
      `最低成员满意度 ${Math.round(minUtility * 100)}`,
      `Nash 群体效用 ${Math.round(geoMean * 100)}`,
    ];
    if (contexts.some(({ commute, travelMinutes }) => commute !== null && travelMinutes !== null && travelMinutes > commute)) {
      evidence.push("有成员的估算通勤略超上限，已按超限扣分");
    }
    return [{
      ...candidate,
      groupFit: Math.round(clamp(raw, 0, 1) * 100),
      minUtility: Math.round(minUtility * 100),
      meanUtility: Math.round(meanUtility * 100),
      geoMean: Math.round(geoMean * 100),
      evidence,
      explanation: `${evidence.join("；")}。先保护每个人的底线，再比较最低满意度与群体整体福利。`,
      memberUtilities: roundedMemberUtilities,
      meanTravelMinutes: averageKnown(roundedMemberUtilities.map((item) => item.travelMinutes)),
      onParetoFrontier: false,
    }];
  });

  const withFrontier = scored.map((candidate) => ({
    ...candidate,
    onParetoFrontier: !scored.some((other) => other.id !== candidate.id && dominates(other.memberUtilities, candidate.memberUtilities)),
  }));
  const floorExists = withFrontier.some((candidate) => candidate.minUtility >= 60);
  return withFrontier.sort((left, right) => {
    if (floorExists && (left.minUtility >= 60) !== (right.minUtility >= 60)) return left.minUtility >= 60 ? -1 : 1;
    if (left.onParetoFrontier !== right.onParetoFrontier) return left.onParetoFrontier ? -1 : 1;
    return right.groupFit - left.groupFit || right.minUtility - left.minUtility || right.meanUtility - left.meanUtility;
  });
}

export function diagnoseParticipantConflict(room: ParticipantRoom): ParticipantConflict[] {
  if (!isCompletedParticipantRound(room)) return [];
  const reasons: ParticipantConflict[] = [];
  for (const member of room.members) {
    const rejected = room.candidates.filter((candidate) => member.choices[candidate.id] === "no").length;
    if (rejected) reasons.push({
      type: rejected === room.candidates.length ? "all_rejected" : "choice_rejection",
      memberId: member.id,
      affectedCount: rejected,
      message: rejected === room.candidates.length
        ? `${member.name || "一位成员"} 拒绝了本轮全部候选`
        : `${member.name || "一位成员"} 的选择排除了 ${rejected}/${room.candidates.length} 张候选`,
    });

    const commute = parseCommuteLimit(member.commuteLabel);
    if (commute !== null) {
      const affected = room.candidates.filter((candidate) => {
        const travel = estimateTravelBetween(member.originLocation, candidate.location) ?? candidate.estimatedTravelMinutes;
        return travel !== null && travel > commute;
      }).length;
      if (affected) reasons.push({ type: "commute", memberId: member.id, affectedCount: affected, message: `${member.name || "一位成员"} 的通勤上限影响了 ${affected}/${room.candidates.length} 张候选` });
    }

    const budget = mergeLimit(parseLabelNumber(member.budgetLabel), extractionNumber(member.extraction, "max_budget"));
    if (budget !== null) {
      const affected = room.candidates.filter((candidate) => candidate.priceValue !== null && candidate.priceValue > budget).length;
      if (affected) reasons.push({ type: "budget", memberId: member.id, affectedCount: affected, message: `${member.name || "一位成员"} 的预算上限影响了 ${affected}/${room.candidates.length} 张候选` });
    }

    const start = Math.max(toMinutes(room.config.startTime), extractionTime(member.extraction, "arrival_after") ?? 0);
    const end = Math.min(toMinutes(room.config.endTime), extractionTime(member.extraction, "leave_before") ?? 24 * 60);
    const durationAffected = room.candidates.filter((candidate) => candidate.durationMinutes > Math.max(0, end - start)).length;
    if (durationAffected) reasons.push({ type: "duration", memberId: member.id, affectedCount: durationAffected, message: `${member.name || "一位成员"} 的可用时间影响了 ${durationAffected}/${room.candidates.length} 张候选` });

    const noSpicy = member.setting === "不吃辣" || hasExtractionConstraint(member.extraction, "no_spicy");
    const spicyAffected = noSpicy ? room.candidates.filter((candidate) => candidate.features.nonSpicyAvailable === false).length : 0;
    if (spicyAffected) reasons.push({ type: "no_spicy", memberId: member.id, affectedCount: spicyAffected, message: `${member.name || "一位成员"} 的不吃辣约束影响了 ${spicyAffected}/${room.candidates.length} 张候选` });
  }

  const unknownAffected = room.candidates.filter((candidate) => room.members.some((member) => {
    const budgetKnown = mergeLimit(parseLabelNumber(member.budgetLabel), extractionNumber(member.extraction, "max_budget")) !== null;
    const commuteKnown = parseCommuteLimit(member.commuteLabel) !== null;
    const travel = estimateTravelBetween(member.originLocation, candidate.location) ?? candidate.estimatedTravelMinutes;
    const noSpicy = member.setting === "不吃辣" || hasExtractionConstraint(member.extraction, "no_spicy");
    return (budgetKnown && candidate.priceValue === null)
      || (commuteKnown && travel === null)
      || (noSpicy && candidate.features.nonSpicyAvailable === null)
      || hasExtractionConstraint(member.extraction, "allergy");
  })).length;
  if (unknownAffected) reasons.push({ type: "unknown_hard_fact", affectedCount: unknownAffected, message: `有 ${unknownAffected}/${room.candidates.length} 张候选缺少可核验地点事实` });
  const order: ParticipantConflict["type"][] = ["all_rejected", "choice_rejection", "commute", "budget", "duration", "no_spicy", "unknown_hard_fact"];
  return reasons.sort((left, right) => right.affectedCount - left.affectedCount || order.indexOf(left.type) - order.indexOf(right.type) || (left.memberId ?? "").localeCompare(right.memberId ?? ""));
}

export function suggestParticipantCommuteRelaxation(room: ParticipantRoom): ParticipantCommuteRelaxation | null {
  if (!isCompletedParticipantRound(room) || participantRankings(room).length > 0) return null;
  const suggestions = room.members.flatMap((member) => {
    const currentMinutes = parseCommuteLimit(member.commuteLabel);
    if (currentMinutes === null) return [];
    const over = room.candidates
      .filter((candidate) => candidateCanBeRestoredByCommute(room, candidate, member.id, currentMinutes))
      .map((candidate) => estimateTravelBetween(member.originLocation, candidate.location) ?? candidate.estimatedTravelMinutes)
      .filter((minutes): minutes is number => minutes !== null)
      .sort((left, right) => left - right);
    if (!over.length) return [];
    const suggestedMinutes = Math.ceil(over[0]);
    return [{
      memberId: member.id,
      memberName: member.name || "一位成员",
      currentMinutes,
      suggestedMinutes,
      addedMinutes: suggestedMinutes - currentMinutes,
      restoredCandidateCount: over.filter((minutes) => minutes <= suggestedMinutes).length,
    }];
  });
  return suggestions.sort((left, right) => left.addedMinutes - right.addedMinutes || right.restoredCandidateCount - left.restoredCandidateCount)[0] ?? null;
}

function candidateCanBeRestoredByCommute(room: ParticipantRoom, candidate: Candidate, affectedMemberId: string, currentMinutes: number) {
  if (candidate.priceValue === null) return false;
  let affectedCommuteIsBlocker = false;
  for (const member of room.members) {
    if (member.choices[candidate.id] === "no") return false;
    const budget = mergeLimit(parseLabelNumber(member.budgetLabel), extractionNumber(member.extraction, "max_budget"));
    if (budget !== null && candidate.priceValue > budget) return false;
    const start = Math.max(toMinutes(room.config.startTime), extractionTime(member.extraction, "arrival_after") ?? 0);
    const end = Math.min(toMinutes(room.config.endTime), extractionTime(member.extraction, "leave_before") ?? 24 * 60);
    if (candidate.durationMinutes > Math.max(0, end - start)) return false;
    if ((member.setting === "不吃辣" || hasExtractionConstraint(member.extraction, "no_spicy")) && candidate.features.nonSpicyAvailable === false) return false;

    const travel = estimateTravelBetween(member.originLocation, candidate.location) ?? candidate.estimatedTravelMinutes;
    if (member.id === affectedMemberId) {
      affectedCommuteIsBlocker = travel !== null && travel > currentMinutes + commuteToleranceMinutes;
      continue;
    }
    const commute = parseCommuteLimit(member.commuteLabel);
    if (commute !== null && travel !== null && travel > commute + commuteToleranceMinutes) return false;
  }
  return affectedCommuteIsBlocker;
}

export function pendingRecoveryMessage(room: ParticipantRoom) {
  if (!isCompletedParticipantRound(room)) {
    const pending = room.members.filter((member) => !member.submittedAt).map((member) => member.name);
    return pending.length ? `等待${pending.join("、")}完成本轮选择` : "等待本轮完成";
  }
  const pending = room.members.filter((member) => member.refreshRequestRound !== room.currentRound).map((member) => member.name);
  return pending.length ? `等待${pending.join("、")}完成本轮恢复操作` : "等待房主开启下一轮";
}

export function resultWaitMessage(room: ParticipantRoom) {
  if (room.currentRound < 3) return pendingRecoveryMessage(room);
  const commute = suggestParticipantCommuteRelaxation(room);
  return commute ? `等待 ${commute.memberName} 确认通勤调整` : pendingRecoveryMessage(room);
}

export function deterministicRoundInsight(room: ParticipantRoom) {
  const scores = new Map<string, number>();
  for (const candidate of room.candidates) {
    const category = candidate.type;
    const score = room.members.reduce((total, member) => {
      const choice = member.choices[candidate.id];
      return total + (choice === "like" ? 2 : choice === "okay" ? 0.5 : choice === "no" ? -1 : 0);
    }, 0);
    scores.set(category, (scores.get(category) ?? 0) + score);
  }
  const strongest = [...scores].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0];
  const learned = strongest && strongest[1] > 0
    ? `本轮对${strongest[0]}的反馈最积极，下一轮会继续保留这类线索。`
    : "本轮尚未形成明确的正向类型偏好，系统会更多参考拒绝原因与新类型探索。";
  const conflict = diagnoseParticipantConflict(room)[0]?.message || "没有单一边界独自阻断结果，需要结合多人反馈继续探索。";
  const nominations = room.nominationCount || 0;
  const nextRound = nominations > 0
    ? `下一轮会带入 ${nominations} 张成员提名，并结合群体反馈补充新类型。`
    : "下一轮会结合本轮反馈与私人提名，同时保留新类型探索。";
  return { mode: "deterministic" as const, learned, conflict, nextRound };
}

export function togglePrivateNomination(currentId: string | null, candidateId: string) {
  return currentId === candidateId ? null : candidateId;
}

export function roomShareCard(roomCode: string, kind: DecisionKind) {
  return {
    title: kind === "activity" ? "一起决定周末去哪玩" : "一起决定这顿饭吃什么",
    path: `/pages/home/index?room=${roomCode}`,
  };
}

export function isCompletedParticipantRound(room: ParticipantRoom) {
  return room.members.length === room.config.people
    && room.candidates.length === 12
    && room.members.every((member) => Boolean(member.submittedAt) && room.candidates.every((candidate) => Boolean(member.choices[candidate.id])));
}

export function canOpenPrivateDiscovery(room: ParticipantRoom, memberId: string) {
  if (room.currentRound >= 3 || !isCompletedParticipantRound(room)) return false;
  const member = room.members.find((item) => item.id === memberId);
  if (!member) return false;
  const selfRejectedAll = room.candidates.every((candidate) => member.choices[candidate.id] === "no");
  const noIntersection = participantRankings(room).length === 0
    || room.candidates.every((candidate) => room.members.some((item) => item.choices[candidate.id] === "no"));
  return selfRejectedAll || noIntersection;
}

function advancePermitted(room: ParticipantRoom) {
  if (room.currentRound >= 3 || !isCompletedParticipantRound(room)) return false;
  const providers = room.candidates.map((candidate) => candidate.source.providerId || candidate.id);
  if (new Set(providers).size !== 12) return false;
  const noIntersection = participantRankings(room).length === 0
    || room.candidates.every((candidate) => room.members.some((member) => member.choices[candidate.id] === "no"));
  return !noIntersection || room.members.every((member) => member.refreshRequestRound === room.currentRound);
}

function scoreMember(candidate: Candidate, choice: Choice | undefined, setting: string, extraction: unknown, budget: number | null, commute: number | null, travel: number | null) {
  let score = choice === "like" ? 0.94 : choice === "okay" ? 0.62 : 0.5;
  const adjustments: number[] = [];
  if (budget !== null && candidate.priceValue !== null) adjustments.push(clamp(1 - candidate.priceValue / Math.max(budget, 1) * 0.5, 0.35, 1));
  if (commute !== null && travel !== null) {
    const ratio = travel / Math.max(commute, 1);
    adjustments.push(ratio > 1 ? clamp(0.5 - (ratio - 1) * 1.2, 0.05, 0.5) : clamp(1 - ratio * 0.35, 0.65, 1));
  }
  if (setting === "室内优先" && candidate.features.indoor !== null) adjustments.push(candidate.features.indoor ? 0.95 : 0.45);
  if (setting === "户外优先" && candidate.features.indoor !== null) adjustments.push(candidate.features.indoor ? 0.45 : 0.95);
  if (setting === "安静聊天") {
    if (candidate.features.quiet !== null) adjustments.push(candidate.features.quiet ? 0.98 : 0.42);
    if (candidate.features.conversationFriendly !== null) adjustments.push(candidate.features.conversationFriendly ? 0.96 : 0.5);
  }
  if (setting === "热闹聚会" && candidate.features.quiet !== null) adjustments.push(candidate.features.quiet ? 0.58 : 0.94);
  if (setting === "不吃辣" && candidate.features.nonSpicyAvailable !== null) adjustments.push(candidate.features.nonSpicyAvailable ? 0.95 : 0.1);
  for (const preference of extractionPreferences(extraction)) adjustments.push(featureMatch(candidate, preference.feature));
  if (candidate.rating !== null) adjustments.push(clamp(candidate.rating / 5, 0.5, 1));
  if (adjustments.length) score = 0.58 * score + 0.42 * (adjustments.reduce((sum, value) => sum + value, 0) / adjustments.length);
  return clamp(score, 0.05, 0.99);
}

function featureMatch(candidate: Candidate, feature: string) {
  if (feature === "quiet") return tri(candidate.features.quiet);
  if (feature === "conversation") return tri(candidate.features.conversationFriendly);
  if (feature === "indoor") return tri(candidate.features.indoor);
  if (feature === "outdoor") return candidate.features.indoor === null ? 0.55 : candidate.features.indoor ? 0.3 : 0.95;
  if (feature === "queue_time") return candidate.features.queueRisk === "low" ? 0.95 : candidate.features.queueRisk === "medium" ? 0.6 : candidate.features.queueRisk === "high" ? 0.25 : 0.55;
  if (feature === "price") return candidate.priceValue === null ? 0.55 : clamp(1 - candidate.priceValue / 350, 0.25, 0.95);
  return 0.55;
}

function extractionConstraints(extraction: unknown) {
  if (!extraction || typeof extraction !== "object") return [];
  const constraints = (extraction as { hardConstraints?: unknown }).hardConstraints;
  return Array.isArray(constraints) ? constraints.filter((item): item is { type: string; value: string } => Boolean(item && typeof item === "object" && typeof item.type === "string" && typeof item.value === "string")) : [];
}

function extractionPreferences(extraction: unknown) {
  if (!extraction || typeof extraction !== "object") return [];
  const preferences = (extraction as { softPreferences?: unknown }).softPreferences;
  return Array.isArray(preferences) ? preferences.filter((item): item is { feature: string } => Boolean(item && typeof item === "object" && typeof item.feature === "string")) : [];
}

function extractionNumber(extraction: unknown, type: string) {
  const value = extractionConstraints(extraction).find((item) => item.type === type)?.value;
  const parsed = Number(value);
  return value && Number.isFinite(parsed) ? parsed : null;
}

function extractionTime(extraction: unknown, type: string) {
  const value = extractionConstraints(extraction).find((item) => item.type === type)?.value;
  return value ? toMinutes(value) : null;
}

function hasExtractionConstraint(extraction: unknown, type: string) {
  return extractionConstraints(extraction).some((item) => item.type === type);
}

function parseLabelNumber(label: string) {
  if (/不限/.test(label)) return null;
  const match = label.match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function parseCommuteLimit(label: string) {
  if (/不限/.test(label)) return null;
  const match = label.match(/(\d+(?:\.\d+)?)\s*(小时|分钟)?/);
  if (!match) return null;
  return match[2] === "小时" ? Math.round(Number(match[1]) * 60) : Number(match[1]);
}

function mergeLimit(left: number | null, right: number | null) {
  if (left === null) return right;
  if (right === null) return left;
  return Math.min(left, right);
}

function estimateTravelBetween(origin: { lng: number; lat: number } | null, destination: { lng: number; lat: number } | null) {
  if (!origin || !destination) return null;
  const rad = Math.PI / 180;
  const dLat = (destination.lat - origin.lat) * rad;
  const dLng = (destination.lng - origin.lng) * rad;
  const value = Math.sin(dLat / 2) ** 2 + Math.cos(origin.lat * rad) * Math.cos(destination.lat * rad) * Math.sin(dLng / 2) ** 2;
  const distance = 6371 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
  return Math.round(clamp(10 + distance * 3.4, 8, 90));
}

function dominates(left: Array<{ memberId: string; utility: number }>, right: Array<{ memberId: string; utility: number }>) {
  if (left.length !== right.length) return false;
  let better = false;
  for (const item of left) {
    const other = right.find((candidate) => candidate.memberId === item.memberId);
    if (!other || item.utility < other.utility) return false;
    if (item.utility > other.utility) better = true;
  }
  return better;
}

function averageKnown(values: Array<number | null>) {
  const known = values.filter((value): value is number => value !== null);
  return known.length ? Math.round(known.reduce((sum, value) => sum + value, 0) / known.length) : null;
}

function toMinutes(value: string) {
  const [hour, minute] = value.split(":").map(Number);
  return Number.isFinite(hour) && Number.isFinite(minute) ? hour * 60 + minute : 0;
}

function tri(value: boolean | null) {
  return value === null ? 0.55 : value ? 0.95 : 0.3;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
