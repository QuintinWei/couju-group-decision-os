import type { StoredMember, StoredRoom } from "./room-store";

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

type PublicMember = Omit<StoredMember, "userId" | "privateDecisionRound"> & { privateDiscoveryCompleted: boolean };
type PeerMember = Omit<PublicMember, "privateCandidates" | "nominatedCandidate" | "availability" | "rejectionReasons"> & { availabilitySubmitted: boolean };
export type ParticipantRoomDto = Omit<StoredRoom, "members"> & { members: Array<PublicMember | PeerMember>; nominationCount: number };

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
  return {
    ...room,
    nominationCount: room.members.filter((member) => member.nominatedCandidate !== null).length,
    members: room.members.map((member) => {
      const { userId, privateDecisionRound, ...memberWithoutPrivateMarker } = member;
      void userId;
      const providerIds = member.privateCandidates.map((candidate) => candidate.source.providerId || candidate.id);
      const publicMember: PublicMember = {
        ...memberWithoutPrivateMarker,
        privateDiscoveryCompleted: privateDecisionRound === room.currentRound && member.privateCandidates.length === 3 && new Set(providerIds).size === 3,
      };
      if (member.id === memberId) return publicMember;
      const { privateCandidates, nominatedCandidate, availability, rejectionReasons, ...peer } = publicMember;
      void privateCandidates;
      void nominatedCandidate;
      void availability;
      void rejectionReasons;
      return { ...peer, availabilitySubmitted: member.availability !== null };
    }),
  };
}
