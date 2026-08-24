import type { StoredMember, StoredRoom } from "./room-store";

export type PublicStoredMember = Omit<StoredMember, "privateCandidates" | "nominatedCandidate">;
export type PublicStoredRoom = Omit<StoredRoom, "members"> & { members: PublicStoredMember[] };

/** The public room endpoint is intentionally safe to poll with only a room code. */
export function toPublicRoom(room: StoredRoom): PublicStoredRoom {
  return {
    ...room,
    members: room.members.map(({ privateCandidates, nominatedCandidate, ...member }) => {
      // Explicitly consume these fields so an accidental spread cannot re-expose them.
      void privateCandidates;
      void nominatedCandidate;
      return member;
    }),
  };
}
