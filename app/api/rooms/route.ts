import { createStoredRoom, getStoredRoom, replaceRoomCandidates } from "../../../lib/room-store";
import { SUPPORTED_CITIES, type Candidate, type RoomConfig } from "../../../lib/couju";
import { geocodeOrigin } from "../../../lib/amap";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const code = new URL(request.url).searchParams.get("code")?.trim().toUpperCase() || "";
  if (!/^[A-Z0-9]{6}$/.test(code)) return Response.json({ error: "房间号无效" }, { status: 400 });
  try {
    const room = await getStoredRoom(code);
    if (!room) return Response.json({ error: "没有找到这个房间" }, { status: 404 });
    return Response.json({ room }, { headers: { "Cache-Control": "no-store" } });
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
  if (!config || !SUPPORTED_CITIES.includes(config.city) || !["dining", "activity"].includes(config.kind) || !config.date || !config.startTime || !config.endTime || !Number.isInteger(config.people) || config.people < 2 || config.people > 6 || candidates.length < 1 || !meta || !creatorName || !creatorOrigin) {
    return Response.json({ error: "请完整填写房间信息、昵称和出发地" }, { status: 400 });
  }
  try {
    const suppliedLocation = validLocation(body.creatorOriginLocation);
    const creatorOriginLocation = suppliedLocation || await geocodeOrigin(config.city, creatorOrigin);
    const identity = await createStoredRoom({ config, candidates: candidates.slice(0, 16), meta, creatorName, creatorOrigin, creatorOriginLocation });
    return Response.json({ identity }, { status: 201 });
  } catch (error) {
    console.error("[rooms:create]", error);
    return Response.json({ error: "房间创建失败，请稍后重试" }, { status: 503 });
  }
}

export async function PATCH(request: Request) {
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; }
  catch { return Response.json({ error: "请求内容无效" }, { status: 400 }); }
  const roomCode = cleanText(body.roomCode, 6).toUpperCase();
  const memberId = cleanText(body.memberId, 64);
  const token = cleanText(body.token, 128);
  const candidates = Array.isArray(body.candidates) ? body.candidates as Candidate[] : [];
  const meta = body.meta && typeof body.meta === "object" ? body.meta as { mode: "live" | "demo"; label: string; fetchedAt: string } : null;
  if (!/^[A-Z0-9]{6}$/.test(roomCode) || !memberId || !token || candidates.length < 1 || !meta) return Response.json({ error: "候选更新请求无效" }, { status: 400 });
  try {
    const updated = await replaceRoomCandidates({ roomCode, memberId, token, candidates, meta });
    if (!updated) return Response.json({ error: "只有房间发起人可以更换候选" }, { status: 403 });
    return Response.json({ ok: true });
  } catch (error) {
    console.error("[rooms:replace]", error);
    return Response.json({ error: "更换候选失败，请稍后重试" }, { status: 503 });
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
