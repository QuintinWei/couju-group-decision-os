import { isParticipantSelfMember, type DecisionKind, type ParticipantCommuteRelaxation, type ParticipantConflict, type ParticipantRanking, type ParticipantRoom } from "../types/api.ts";

export type ResultAction = "result" | "wait" | "private-discovery" | "advance" | "edit-commute";

export type { ParticipantCommuteRelaxation, ParticipantConflict, ParticipantRanking } from "../types/api.ts";

export function resultAction(room: ParticipantRoom, memberId: string): ResultAction {
  const member = room.members.find((item) => item.id === memberId);
  if (!member) return "wait";
  const privateRecoveryComplete = member.privateDiscoveryCompleted && isParticipantSelfMember(member) && member.privateCandidates.length === 3;
  if (room.currentRound < 3 && canOpenPrivateDiscovery(room, memberId) && !privateRecoveryComplete) return "private-discovery";
  if (!isCompletedParticipantRound(room)) return "wait";
  if (participantRankings(room).length > 0) return "result";

  if (room.currentRound < 3) {
    if (advancePermitted(room)) return room.members[0]?.id === memberId ? "advance" : "wait";
    return "wait";
  }

  const commute = suggestParticipantCommuteRelaxation(room);
  if (commute) return commute.memberId === memberId ? "edit-commute" : "wait";
  return "wait";
}

export function participantRankings(room: ParticipantRoom): ParticipantRanking[] {
  return room.decision?.rankings ?? [];
}

export function diagnoseParticipantConflict(room: ParticipantRoom): ParticipantConflict[] {
  return room.decision?.conflicts ?? [];
}

export function suggestParticipantCommuteRelaxation(room: ParticipantRoom): ParticipantCommuteRelaxation | null {
  return room.decision?.commuteRelaxation ?? null;
}

export function pendingRecoveryMessage(room: ParticipantRoom) {
  if (!isCompletedParticipantRound(room)) {
    const pending = room.members.filter((member) => !member.submittedAt).map((member) => member.name);
    return pending.length ? `等待${pending.join("、")}完成本轮选择` : "等待本轮完成";
  }
  const pending = room.members.filter((member) => !member.privateDiscoveryCompleted).map((member) => member.name);
  return pending.length ? `等待${pending.join("、")}完成本轮恢复操作` : "等待房主开启下一轮";
}

export function resultWaitMessage(room: ParticipantRoom) {
  if (room.currentRound < 3) return pendingRecoveryMessage(room);
  const commute = suggestParticipantCommuteRelaxation(room);
  return commute ? `等待 ${commute.memberName} 确认通勤调整` : pendingRecoveryMessage(room);
}

export function deterministicRoundInsight(room: ParticipantRoom) {
  const learned = participantRankings(room)[0]
    ? `本轮已经找到共同可接受的候选，系统优先保护最低满意度并兼顾群体整体福利。`
    : "本轮尚未形成共同可接受的候选，系统会参考拒绝原因与私人提名继续探索。";
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
  return room.decision !== null;
}

export function canOpenPrivateDiscovery(room: ParticipantRoom, memberId: string) {
  if (room.currentRound >= 3 || room.candidates.length !== 12) return false;
  const member = room.members.find((item) => item.id === memberId);
  if (!member || !isParticipantSelfMember(member)) return false;
  const selfRejectedAll = room.candidates.every((candidate) => member.choices[candidate.id] === "no");
  if (selfRejectedAll) return true;
  if (!isCompletedParticipantRound(room)) return false;
  return participantRankings(room).length === 0;
}

function advancePermitted(room: ParticipantRoom) {
  if (room.currentRound >= 3 || !isCompletedParticipantRound(room)) return false;
  const providers = room.candidates.map((candidate) => candidate.source.providerId || candidate.id);
  if (new Set(providers).size !== 12) return false;
  const noIntersection = participantRankings(room).length === 0;
  return !noIntersection || room.members.every((member) => member.privateDiscoveryCompleted);
}
