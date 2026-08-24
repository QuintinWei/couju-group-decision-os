import { SUPPORTED_CITIES, type Candidate, type RoomConfig } from "../../../lib/couju";
import { geocodeOrigin } from "../../../lib/amap";
import { toJoinRoom, toParticipantRoom } from "../../../lib/public-room";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code")?.trim().toUpperCase() || "";
  if (!/^[A-Z0-9]{6}$/.test(code)) return Response.json({ error: "房间号无效" }, { status: 400 });
  try {
    const memberId = cleanText(url.searchParams.get("memberId"), 64);
    const token = cleanText(url.searchParams.get("token"), 128);
    if (Boolean(memberId) !== Boolean(token)) return Response.json({ error: "成员身份无效" }, { status: 400 });
    const { getAuthenticatedStoredRoom, getStoredRoom } = await loadRoomStore();
    const room = memberId && token
      ? await getAuthenticatedStoredRoom({ roomCode: code, memberId, token })
      : await getStoredRoom(code);
    if (!room) return Response.json({ error: memberId ? "成员身份已失效，请重新加入" : "没有找到这个房间" }, { status: memberId ? 403 : 404 });
    if (memberId && token) return Response.json({ room: toParticipantRoom(room, memberId) }, { headers: { "Cache-Control": "private, no-store" } });
    return Response.json({ room: toJoinRoom(room) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[rooms:get]", error);
    return Response.json({ error: "房间服务暂时不可用" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; }
  catch { return Response.json({ error: "请求内容无效" }, { status: 400 }); }

  const config = body.config as RoomConfig | undefined;
  const candidates = Array.isArray(body.candidates) ? body.candidates as Candidate[] : [];
  const meta = body.meta && typeof body.meta === "object" ? body.meta as { mode: "live" | "demo"; label: string; fetchedAt: string; disclaimer?: string } : null;
  const creatorName = cleanText(body.creatorName, 18);
  const creatorOrigin = cleanText(body.creatorOrigin, 40);
  if (!config || !SUPPORTED_CITIES.includes(config.city) || !["dining", "activity"].includes(config.kind) || !config.date || !config.startTime || !config.endTime || !Number.isInteger(config.people) || config.people < 2 || config.people > 6 || candidates.length !== 12 || !hasUniqueProviderIds(candidates) || !meta || !creatorName || !creatorOrigin) {
    return Response.json({ error: "请完整填写房间信息、昵称和出发地" }, { status: 400 });
  }
  try {
    const suppliedLocation = validLocation(body.creatorOriginLocation);
    const creatorOriginLocation = suppliedLocation || await geocodeOrigin(config.city, creatorOrigin);
    const { createStoredRoom } = await loadRoomStore();
    const identity = await createStoredRoom({ config, candidates, meta, creatorName, creatorOrigin, creatorOriginLocation });
    return Response.json({ identity }, { status: 201 });
  } catch (error) {
    console.error("[rooms:create]", error);
    return Response.json({ error: "房间创建失败，请稍后重试" }, { status: 503 });
  }
}

function cleanText(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().replace(/[<>]/g, "").slice(0, max) : "";
}

function validLocation(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const point = value as { lng?: unknown; lat?: unknown };
  const lng = Number(point.lng); const lat = Number(point.lat);
  return Number.isFinite(lng) && Number.isFinite(lat) && lng >= -180 && lng <= 180 && lat >= -90 && lat <= 90 ? { lng, lat } : null;
}

function hasUniqueProviderIds(candidates: Candidate[]) {
  const ids = candidates.map((candidate) => candidate.source?.providerId || candidate.id);
  return new Set(ids).size === ids.length;
}

async function loadRoomStore() {
  return import("../../../lib/room-store");
}
