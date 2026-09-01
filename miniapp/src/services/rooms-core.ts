import { normalizeRoomCode } from "../domain/session.ts";
import { validateCreateDraft, type CreateDraft, type GeoPoint } from "../domain/create-room.ts";
import type { Candidate, Membership, Session } from "../types/api.ts";
import type { ApiRequestOptions } from "./request-core.ts";

type ApiRequest = <T>(path: string, options?: ApiRequestOptions) => Promise<T>;
type CandidateMeta = { mode: "live" | "demo"; label: string; fetchedAt: string; disclaimer?: string };

type RoomsServiceDependencies = {
  request: ApiRequest;
  resolveOrigin: (city: string, origin: string) => Promise<{ location: GeoPoint; label: string }>;
  saveMembership: (membership: Membership) => void;
  createSeed: () => string;
};

export function createRoomsService({ request, resolveOrigin, saveMembership, createSeed }: RoomsServiceDependencies) {
  async function createRoom(draft: CreateDraft, user: Session["user"]): Promise<Membership> {
    const validation = validateCreateDraft(draft);
    if (!validation.ok) throw new Error(validation.message);
    void user;

    const resolved = draft.originLocation
      ? { location: draft.originLocation, label: draft.origin.trim() }
      : await resolveOrigin(draft.city, draft.origin.trim());
    const candidatePayload = await request<{ candidates?: Candidate[]; meta?: CandidateMeta }>(candidatePath(draft, resolved.location, createSeed()));
    if (!candidatePayload.meta || !hasTwelveUniqueCandidates(candidatePayload.candidates)) {
      throw new Error("创建房间需要正好 12 个不重复候选，请稍后重试");
    }

    const payload = await request<{ identity?: { code: string; memberId: string; memberToken: string } }>("/api/rooms", {
      method: "POST",
      data: {
        config: {
          kind: draft.kind,
          city: draft.city,
          people: draft.people,
          dateRange: draft.dateRange,
          preferredPeriods: draft.preferredPeriods,
          durationMinutes: draft.durationMinutes,
          resolvedSchedule: null,
          date: draft.dateRange.start,
          startTime: "",
          endTime: "",
        },
        candidates: candidatePayload.candidates,
        meta: candidatePayload.meta,
        creatorOrigin: resolved.label,
        creatorOriginLocation: resolved.location,
      },
    });
    if (!payload.identity) throw new Error("房间创建返回无效");
    const membership = {
      roomCode: normalizeRoomCode(payload.identity.code),
      memberId: payload.identity.memberId,
      memberToken: payload.identity.memberToken,
    };
    saveMembership(membership);
    return membership;
  }

  async function joinRoom(roomCode: string, origin: string, originLocation: GeoPoint | null): Promise<Membership> {
    const normalizedRoomCode = normalizeRoomCode(roomCode);
    if (!/^[A-Z0-9]{6}$/.test(normalizedRoomCode)) throw new Error("请输入 6 位房间码");
    if (!origin.trim()) throw new Error("请填写出发地");
    const payload = await request<{ identity?: { id: string; token: string } }>("/api/members", {
      method: "POST",
      data: { roomCode: normalizedRoomCode, origin: origin.trim(), originLocation },
    });
    if (!payload.identity) throw new Error("加入房间返回无效");
    const membership = { roomCode: normalizedRoomCode, memberId: payload.identity.id, memberToken: payload.identity.token };
    saveMembership(membership);
    return membership;
  }

  return { createRoom, joinRoom };
}

function candidatePath(draft: CreateDraft, location: GeoPoint, seed: string) {
  const focused = draft.discoveryMode === "ideas" && draft.tendencies.length > 0;
  const params: Array<[string, string]> = [
    ["city", draft.city],
    ["kind", draft.kind],
    ["strategy", focused ? "focused" : "explore"],
    ["seed", seed],
    ["location", `${location.lng},${location.lat}`],
  ];
  if (focused) params.push(["interests", draft.tendencies.join(",")]);
  const avoid = draft.avoid.split(/[，,、;；]+/).map((item) => item.trim()).filter(Boolean);
  if (draft.discoveryMode === "ideas" && avoid.length) params.push(["avoid", avoid.join(",")]);
  return `/api/candidates?${params.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join("&")}`;
}

function hasTwelveUniqueCandidates(candidates: Candidate[] | undefined): candidates is Candidate[] {
  if (!Array.isArray(candidates) || candidates.length !== 12) return false;
  const ids = candidates.map((candidate) => candidate.source?.providerId || candidate.id).filter(Boolean);
  return ids.length === 12 && new Set(ids).size === 12;
}
