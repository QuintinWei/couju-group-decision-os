import { getStoredRoom, joinStoredRoom, updateStoredMember } from "../../../lib/room-store";
import type { Choice, PreferenceExtraction } from "../../../lib/couju";
import { geocodeOrigin } from "../../../lib/amap";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; }
  catch { return Response.json({ error: "请求内容无效" }, { status: 400 }); }
  const roomCode = cleanText(body.roomCode, 6).toUpperCase();
  const name = cleanText(body.name, 18);
  const origin = cleanText(body.origin, 40);
  if (!/^[A-Z0-9]{6}$/.test(roomCode) || !name || !origin) return Response.json({ error: "请填写昵称和附近地铁站或商圈" }, { status: 400 });
  try {
    const room = await getStoredRoom(roomCode);
    if (!room) return Response.json({ error: "没有找到这个房间" }, { status: 404 });
    const supplied = validLocation(body.originLocation);
    const originLocation = supplied || await geocodeOrigin(room.config.city, origin);
    if (!originLocation) return Response.json({ error: `没有识别到“${origin}”，请填写完整地铁站 / 商圈名或使用系统定位` }, { status: 422 });
    const identity = await joinStoredRoom(roomCode, name, origin, originLocation);
    if (!identity) return Response.json({ error: "没有找到这个房间" }, { status: 404 });
    return Response.json({ identity }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "ROOM_FULL") return Response.json({ error: "房间人数已满" }, { status: 409 });
    console.error("[members:join]", error);
    return Response.json({ error: "加入房间失败，请稍后重试" }, { status: 503 });
  }
}

export async function PATCH(request: Request) {
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; }
  catch { return Response.json({ error: "请求内容无效" }, { status: 400 }); }
  const roomCode = cleanText(body.roomCode, 6).toUpperCase();
  const memberId = cleanText(body.memberId, 64);
  const token = cleanText(body.token, 128);
  if (!/^[A-Z0-9]{6}$/.test(roomCode) || !memberId || !token) return Response.json({ error: "成员身份无效" }, { status: 400 });
  const choices = body.choices && typeof body.choices === "object" ? body.choices as Record<string, Choice> : {};
  const extraction = body.extraction && typeof body.extraction === "object" ? body.extraction as PreferenceExtraction : null;
  try {
    const updated = await updateStoredMember({
      roomCode,
      memberId,
      token,
      budgetLabel: cleanText(body.budgetLabel, 24) || "不限",
      commuteLabel: cleanText(body.commuteLabel, 24) || "不限",
      setting: cleanText(body.setting, 24) || "都可以",
      note: cleanText(body.note, 500),
      extraction,
      choices,
    });
    if (!updated) return Response.json({ error: "成员身份已失效，请重新加入" }, { status: 403 });
    return Response.json({ ok: true });
  } catch (error) {
    console.error("[members:update]", error);
    return Response.json({ error: "偏好提交失败，请稍后重试" }, { status: 503 });
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
