import { updateStoredAvailability } from "../../../lib/room-store";
import type { AvailabilityInterval } from "../../../lib/scheduling";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; }
  catch { return Response.json({ error: "请求内容无效" }, { status: 400 }); }
  const roomCode = clean(body.roomCode, 6).toUpperCase();
  const memberId = clean(body.memberId, 64);
  const token = clean(body.token, 128);
  const expectedRound = body.expectedRound;
  if (!/^[A-Z0-9]{6}$/.test(roomCode) || !memberId || !token || !Number.isInteger(expectedRound) || !Array.isArray(body.intervals)) return Response.json({ error: "空闲时间提交无效" }, { status: 400 });
  const intervals = body.intervals.filter((item): item is AvailabilityInterval => Boolean(item && typeof item === "object" && typeof (item as AvailabilityInterval).startAt === "string" && typeof (item as AvailabilityInterval).endAt === "string"));
  if (intervals.length !== body.intervals.length) return Response.json({ error: "空闲时间格式无效" }, { status: 400 });
  const result = await updateStoredAvailability({ roomCode, memberId, token, expectedRound: expectedRound as number, intervals });
  if (!result.ok) return Response.json({ error: result.code === "UNAUTHORIZED" ? "成员身份已失效" : result.code === "STALE_ROUND" ? "房间状态已更新，请刷新" : "空闲时间不符合房间范围" }, { status: result.code === "UNAUTHORIZED" ? 403 : result.code === "STALE_ROUND" ? 409 : 400 });
  return Response.json({ ok: true, resolution: result.resolution });
}

function clean(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().replace(/[<>]/g, "").slice(0, max) : "";
}
