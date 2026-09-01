import { parseAiEndpointCaller, type AiEndpointCaller } from "./ai-endpoint.ts";
import { buildDeterministicRoundInsight, type RoundInsightInput } from "./round-insight.ts";
import { isCompletedRoundBoundary } from "./round-api.ts";
import { aggregateRoundFeedback, diagnoseRoundConflict } from "./rounds.ts";
import type { StoredRoom } from "./room-store.ts";

type RoomLoader = (caller: AiEndpointCaller) => Promise<StoredRoom | null>;

export async function handleInsightRequest(body: Record<string, unknown>, getAuthenticatedStoredRoom: RoomLoader) {
  const caller = parseAiEndpointCaller(body);
  if (!caller) return Response.json({ error: "成员身份无效" }, { status: 400 });
  const room = await getAuthenticatedStoredRoom(caller);
  if (!room) return Response.json({ error: "成员身份已失效，请重新加入" }, { status: 403 });
  if (!isCompletedRoundBoundary(room)) return Response.json({ error: "本轮尚未完成，暂不能生成学习总结" }, { status: 409 });

  const feedback = aggregateRoundFeedback(room.candidates, room.members);
  const rejectionReasonCounts: Record<string, number> = {};
  for (const member of room.members) for (const reason of Object.values(member.rejectionReasons || {})) rejectionReasonCounts[reason.code] = (rejectionReasonCounts[reason.code] || 0) + 1;
  const input: RoundInsightInput = {
    kind: room.config.kind,
    categoryScores: Object.fromEntries(feedback.categoryScores),
    rejectionReasonCounts,
    conflictMessages: diagnoseRoundConflict(room.candidates, room.members, room.config).slice(0, 3).map((item) => item.message),
    nominationCount: room.members.filter((member) => member.nominatedCandidate).length,
  };
  const fallback = buildDeterministicRoundInsight(input);
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return Response.json({ insight: { ...fallback, mode: "deterministic" } });
  try {
    const endpoint = `${(process.env.DEEPSEEK_API_BASE || "https://api.deepseek.com").replace(/\/+$/, "")}/chat/completions`;
    const official = new URL(endpoint).hostname === "api.deepseek.com";
    const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` }, body: JSON.stringify({
      model: process.env.DEEPSEEK_MODEL || "deepseek-v4-flash",
      messages: [{ role: "system", content: "你是凑局的反馈总结器。只能总结提供的聚合数据，不补造地点事实，不改变算法结果。只输出 JSON。" }, { role: "user", content: `输出简洁中文 JSON {"learned":"45字内","conflict":"45字内","nextRound":"45字内"}。聚合数据：${JSON.stringify(input)}` }],
      ...(official ? { thinking: { type: "disabled" }, response_format: { type: "json_object" } } : {}), max_tokens: 350, temperature: 0.1,
    }), signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`DeepSeek ${response.status}`);
    const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = payload.choices?.[0]?.message?.content || "";
    const parsed = JSON.parse(content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")) as Record<string, unknown>;
    const clean = (value: unknown, fallbackValue: string) => typeof value === "string" && value.trim() ? value.trim().slice(0, 80) : fallbackValue;
    return Response.json({ insight: { mode: "deepseek", learned: clean(parsed.learned, fallback.learned), conflict: clean(parsed.conflict, fallback.conflict), nextRound: clean(parsed.nextRound, fallback.nextRound) } });
  } catch (cause) {
    console.warn("[insights] AI fallback:", cause instanceof Error ? cause.message : "unknown error");
    return Response.json({ insight: { ...fallback, mode: "deterministic" } });
  }
}
