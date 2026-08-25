import { getStoredRoom, joinStoredRoom, replaceInitialCandidates, saveStoredMemberConstraints, updateStoredMember } from "../../../lib/room-store";
import type { Candidate, Choice, PreferenceExtraction } from "../../../lib/couju";
import { geocodeOrigin } from "../../../lib/amap";
import { isChoiceRecord } from "../../../lib/member-submission";
import { selectGroupReachableCandidates } from "../../../lib/group-candidate-intersection";
import { GET as getCandidates } from "../candidates/route";

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
  if (body.action === "constraints") return saveConstraintsAndBuildIntersection(request, body, { roomCode, memberId, token });
  const expectedRound = body.expectedRound;
  if (typeof expectedRound !== "number" || !Number.isInteger(expectedRound) || expectedRound < 1 || expectedRound > 3 || !isChoiceRecord(body.choices)) {
    return Response.json({ error: "轮次或 12 张候选选择无效" }, { status: 400 });
  }
  const choices = body.choices as Record<string, Choice>;
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
      expectedRound,
    });
    if (!updated.ok) {
      if (updated.code === "UNAUTHORIZED") return Response.json({ error: "成员身份已失效，请重新加入" }, { status: 403 });
      if (updated.code === "STALE_ROUND") return Response.json({ error: "房间已进入下一轮，请刷新后重新选择" }, { status: 409 });
      return Response.json({ error: "必须且只能评价当前轮全部 12 张候选" }, { status: 400 });
    }
    return Response.json({ ok: true });
  } catch (error) {
    console.error("[members:update]", error);
    return Response.json({ error: "偏好提交失败，请稍后重试" }, { status: 503 });
  }
}

async function saveConstraintsAndBuildIntersection(request: Request, body: Record<string, unknown>, auth: { roomCode: string; memberId: string; token: string }) {
  const saved = await saveStoredMemberConstraints({ ...auth, budgetLabel: cleanText(body.budgetLabel, 24) || "不限", commuteLabel: cleanText(body.commuteLabel, 24) || "不限", setting: cleanText(body.setting, 24) || "都可以" });
  if (!saved.ok) return Response.json({ error: "成员身份已失效，请重新加入" }, { status: 403 });
  const room = await getStoredRoom(auth.roomCode);
  if (!room) return Response.json({ error: "房间不存在" }, { status: 404 });
  if (room.members.length !== room.config.people || room.members.some((member) => !member.constraintsReady)) return Response.json({ ok: true, ready: false });

  const points = room.members.map((member) => member.originLocation).filter((point): point is { lng: number; lat: number } => Boolean(point));
  if (points.length !== room.config.people) return Response.json({ error: "仍有成员缺少有效出发地" }, { status: 409 });
  const center = { lng: points.reduce((sum, point) => sum + point.lng, 0) / points.length, lat: points.reduce((sum, point) => sum + point.lat, 0) / points.length };
  const pool: Candidate[] = []; let sourceMeta: Record<string, unknown> | null = null;
  for (let batch = 0; batch < 5; batch += 1) {
    const url = new URL("/api/candidates", request.url);
    url.searchParams.set("city", room.config.city); url.searchParams.set("kind", room.config.kind); url.searchParams.set("strategy", "explore");
    url.searchParams.set("location", `${center.lng},${center.lat}`); url.searchParams.set("batch", String(batch)); url.searchParams.set("seed", `${room.code}-intersection-${batch}`);
    const response = await getCandidates(new Request(url));
    const payload = await response.json() as { candidates?: Candidate[]; meta?: Record<string, unknown> };
    if (Array.isArray(payload.candidates)) pool.push(...payload.candidates);
    if (payload.meta) sourceMeta = payload.meta;
  }
  const unique = [...new Map(pool.map((candidate) => [candidate.source.providerId || candidate.id, candidate])).values()];
  const candidates = selectGroupReachableCandidates(unique, room.members, 12);
  if (candidates.length < 12) return Response.json({ error: `当前通勤上限的共同可达地点不足 12 个（找到 ${candidates.length} 个），请至少一位成员放宽通勤时间` }, { status: 409 });
  const meta = { ...(sourceMeta || room.meta), center, label: "多人通勤可达交集", commuteWindow: "逐成员上限交集", groupIntersection: true, fetchedAt: new Date().toISOString() };
  const replaced = await replaceInitialCandidates({ ...auth, candidates, meta });
  if (!replaced.ok) return Response.json({ error: "共享卡池生成状态已变化，请刷新房间" }, { status: 409 });
  return Response.json({ ok: true, ready: true, candidates, meta });
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
