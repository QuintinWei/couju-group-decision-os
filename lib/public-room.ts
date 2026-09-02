import { rankGroupCandidates, type RankedCandidate } from "./couju.ts";
import { isCompletedRoundBoundary } from "./round-api.ts";
import { diagnoseRoundConflict, suggestMinimumCommuteRelaxation, type CommuteRelaxationSuggestion, type ConflictReason } from "./rounds.ts";
import type { StoredMember, StoredRoom } from "./room-store.ts";

export type JoinRoomDto = {
  code: string;
  title: string;
  kind: StoredRoom["config"]["kind"];
  city: StoredRoom["config"]["city"];
  date: string;
  startTime: string;
  endTime: string;
  dateRange: StoredRoom["config"]["dateRange"];
  preferredPeriods: StoredRoom["config"]["preferredPeriods"];
  durationMinutes: StoredRoom["config"]["durationMinutes"];
  resolvedSchedule: StoredRoom["config"]["resolvedSchedule"];
  targetCount: number;
  joinedCount: number;
  status: "open" | "full";
};

type ParticipantMemberStatus = {
  id: string;
  name: string;
  locationReady: boolean;
  availabilitySubmitted: boolean;
  constraintsReady: boolean;
  submittedAt: string | null;
  refreshRequestRound: number | null;
  privateDiscoveryCompleted: boolean;
};

export type ParticipantSelfMember = Omit<StoredMember, "userId" | "privateDecisionRound"> & ParticipantMemberStatus;
export type ParticipantPeerMember = ParticipantMemberStatus;
export type ParticipantMemberDto = ParticipantSelfMember | ParticipantPeerMember;

export type ParticipantDecision = {
  rankings: RankedCandidate[];
  conflicts: Array<Omit<ConflictReason, "candidateIds">>;
  commuteRelaxation: CommuteRelaxationSuggestion | null;
};

export type ParticipantRoomDto = Omit<StoredRoom, "members" | "roundHistory"> & {
  members: ParticipantMemberDto[];
  roundHistory: Array<{ round: number }>;
  nominationCount: number;
  decision: ParticipantDecision | null;
};

/**
 * Safe for anyone who knows the six-character code. Deliberately omits member
 * display names: the code alone must never reveal who is already in a room.
 */
export function toJoinRoom(room: StoredRoom): JoinRoomDto {
  return {
    code: room.code,
    title: room.config.kind === "dining" ? "这顿饭吃什么" : "周末去哪玩",
    kind: room.config.kind,
    city: room.config.city,
    date: room.config.date,
    startTime: room.config.startTime,
    endTime: room.config.endTime,
    dateRange: room.config.dateRange,
    preferredPeriods: room.config.preferredPeriods,
    durationMinutes: room.config.durationMinutes,
    resolvedSchedule: room.config.resolvedSchedule,
    targetCount: room.config.people,
    joinedCount: room.members.length,
    status: room.members.length >= room.config.people ? "full" : "open",
  };
}

/** Full shared round data requires membership; peer-private rescue state stays isolated. */
export function toParticipantRoom(room: StoredRoom, memberId: string): ParticipantRoomDto {
  const completed = isCompletedRoundBoundary(room);
  const rankings = completed
    ? rankGroupCandidates(room.candidates, room.members, room.config).map((candidate) => ({
      ...candidate,
      // Individual travel estimates can reveal a member's approximate origin.
      // The group aggregate remains useful for comparing final recommendations.
      memberUtilities: candidate.memberUtilities.map((utility) => ({ ...utility, travelMinutes: null })),
    }))
    : [];
  return {
    ...room,
    roundHistory: room.roundHistory.map(({ round }) => ({ round })),
    nominationCount: room.members.filter((member) => member.nominatedCandidate !== null).length,
    decision: completed ? {
      rankings,
      conflicts: rankings.length ? [] : diagnoseRoundConflict(room.candidates, room.members, room.config).map(({ candidateIds, ...reason }) => {
        void candidateIds;
        return reason;
      }),
      commuteRelaxation: rankings.length ? null : suggestMinimumCommuteRelaxation(room.candidates, room.members, room.config),
    } : null,
    members: room.members.map((member) => {
      const providerIds = member.privateCandidates.map((candidate) => candidate.source.providerId || candidate.id);
      const status: ParticipantMemberStatus = {
        id: member.id,
        name: member.name,
        locationReady: member.originLocation !== null && member.originLocation !== undefined,
        availabilitySubmitted: member.availability !== null && member.availability !== undefined,
        constraintsReady: member.constraintsReady,
        submittedAt: member.submittedAt,
        refreshRequestRound: member.refreshRequestRound,
        privateDiscoveryCompleted: member.privateDecisionRound === room.currentRound && member.privateCandidates.length === 3 && new Set(providerIds).size === 3,
      };
      if (member.id !== memberId) return status;
      const { userId, privateDecisionRound, ...self } = member;
      void userId;
      void privateDecisionRound;
      return { ...self, ...status };
    }),
  };
}
