import type { StoredMember, StoredRoom } from "./room-store";

export type JoinRoomDto = {
  code: string;
  title: string;
  kind: StoredRoom["config"]["kind"];
  city: StoredRoom["config"]["city"];
  date: string;
  startTime: string;
  endTime: string;
  targetCount: number;
  joinedCount: number;
  joinedNames: string[];
  status: "open" | "full";
};

type PeerMember = Omit<StoredMember, "privateCandidates" | "nominatedCandidate">;
export type ParticipantRoomDto = Omit<StoredRoom, "members"> & { members: Array<StoredMember | PeerMember> };

/** Safe for anyone who knows the six-character code. */
export function toJoinRoom(room: StoredRoom): JoinRoomDto {
  return {
    code: room.code,
    title: room.config.kind === "dining" ? "这顿饭吃什么" : "周末去哪玩",
    kind: room.config.kind,
    city: room.config.city,
    date: room.config.date,
    startTime: room.config.startTime,
    endTime: room.config.endTime,
    targetCount: room.config.people,
    joinedCount: room.members.length,
    joinedNames: room.members.map((member) => member.name),
    status: room.members.length >= room.config.people ? "full" : "open",
  };
}

/** Full shared round data requires membership; peer-private rescue state stays isolated. */
export function toParticipantRoom(room: StoredRoom, memberId: string): ParticipantRoomDto {
  return {
    ...room,
    members: room.members.map((member) => {
      if (member.id === memberId) return member;
      const { privateCandidates, nominatedCandidate, ...peer } = member;
      void privateCandidates;
      void nominatedCandidate;
      return peer;
    }),
  };
}
