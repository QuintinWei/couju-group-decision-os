import { normalizeRoomCode } from "../domain/session.ts";
import type { AvailabilityInterval, ScheduleResolution } from "../domain/availability.ts";
import type { Membership, ParticipantRoom } from "../types/api.ts";
import type { ApiRequestOptions } from "./request-core.ts";

type ApiRequest = <T>(path: string, options?: ApiRequestOptions) => Promise<T>;

type ConstraintsDraft = {
  budgetLabel: string;
  commuteLabel: string;
  setting: string;
};

export function createMembersService({ request, saveMembership }: { request: ApiRequest; saveMembership: (membership: Membership) => void }) {
  async function restoreMembership(roomCode: string): Promise<Membership> {
    const normalized = validRoomCode(roomCode);
    const response = await request<{ identity?: { memberId: string; memberToken: string } }>(`/api/members?roomCode=${normalized}`);
    if (!response.identity) throw new Error("没有找到你的房间成员身份");
    const membership = { roomCode: normalized, memberId: response.identity.memberId, memberToken: response.identity.memberToken };
    saveMembership(membership);
    return membership;
  }

  async function getParticipantRoom(membership: Membership): Promise<ParticipantRoom> {
    const roomCode = validRoomCode(membership.roomCode);
    const query = [
      ["code", roomCode],
      ["memberId", membership.memberId],
      ["token", membership.memberToken],
    ].map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join("&");
    const response = await request<{ room?: ParticipantRoom }>(`/api/rooms?${query}`);
    if (!response.room) throw new Error("房间返回无效");
    return response.room;
  }

  async function submitAvailability(membership: Membership, expectedRound: number, intervals: AvailabilityInterval[]) {
    return request<{ ok: true; resolution: ScheduleResolution }>("/api/availability", {
      method: "POST",
      membership,
      data: { expectedRound, intervals },
    });
  }

  async function submitConstraints(membership: Membership, draft: ConstraintsDraft) {
    return request<{ ok: true; ready: boolean }>("/api/members", {
      method: "PATCH",
      membership,
      data: { action: "constraints", ...draft },
    });
  }

  async function relaxCommute(membership: Membership, expectedRound: number, minutes: number) {
    return request<{ ok: true }>("/api/members", {
      method: "PATCH",
      membership,
      data: { action: "relax-commute", expectedRound, minutes },
    });
  }

  return { restoreMembership, getParticipantRoom, submitAvailability, submitConstraints, relaxCommute };
}

export async function resolveRoomMembership(
  roomCode: string,
  dependencies: { loadMembership: (roomCode: string) => Membership | null; restoreMembership: (roomCode: string) => Promise<Membership> },
) {
  return dependencies.loadMembership(roomCode) || dependencies.restoreMembership(roomCode);
}

function validRoomCode(value: string) {
  const normalized = normalizeRoomCode(value);
  if (!/^[A-Z0-9]{6}$/.test(normalized)) throw new Error("请输入 6 位房间码");
  return normalized;
}
