import { parseAiEndpointCaller, sanitizeExplainPayload } from "../../../lib/ai-endpoint";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; }
  catch { return Response.json({ error: "请求内容无效" }, { status: 400 }); }
  const { candidates, members } = sanitizeExplainPayload({ candidates: body.candidates, members: body.members });
  if (!candidates.length || !members.length) return Response.json({ error: "缺少计算结果" }, { status: 400 });
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return Response.json({ explanation: null, mode: "deterministic" });

  // 只在真正要花 DeepSeek 额度之前校验成员身份。
  const caller = parseAiEndpointCaller(body);
  if (!caller) return Response.json({ error: "成员身份无效" }, { status: 400 });
  const { authenticateMemberToken } = await import("../../../lib/room-store");
  if (!await authenticateMemberToken(caller)) return Response.json({ error: "成员身份已失效，请重新加入" }, { status: 403 });

  try {
    const endpoint = resolveChatCompletionsUrl(process.env.DEEPSEEK_API_BASE);
    const officialDeepSeek = new URL(endpoint).hostname === "api.deepseek.com";
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: process.env.DEEPSEEK_MODEL || "deepseek-v4-flash",
        messages: [
          { role: "system", content: "你是凑局的决策解释器。算法排序已经完成，你只能解释提供的数据，不能改变名次、补造地点事实或声称可订。只输出 JSON。" },
          { role: "user", content: `请用简洁中文解释第一名为什么是群体平衡解。输出 {"headline":"20字内","reasoning":"70字内","tradeoff":"40字内"}。城市：${clean(body.city, 12)}; 场景：${clean(body.kind, 12)}; 成员：${JSON.stringify(members)}; 已排序候选：${JSON.stringify(candidates)}` },
        ],
        ...(officialDeepSeek ? { thinking: { type: "disabled" }, response_format: { type: "json_object" } } : {}),
        max_tokens: 500,
        temperature: 0.1,
      }),
      signal: AbortSignal.timeout(resolveTimeoutMs(process.env.DEEPSEEK_TIMEOUT_MS)),
    });
    if (!response.ok) throw new Error(`DeepSeek ${response.status}`);
    const payload = await response.json() as { choices?: Array<{ finish_reason?: string; message?: { content?: string } }>; model?: string };
    const content = payload.choices?.[0]?.message?.content;
    if (!content || payload.choices?.[0]?.finish_reason === "length") throw new Error("truncated response");
    const value = parseJsonObject(content) as Record<string, unknown>;
    return Response.json({ explanation: { headline: clean(value.headline, 30), reasoning: clean(value.reasoning, 120), tradeoff: clean(value.tradeoff, 80) }, mode: "deepseek", model: payload.model || process.env.DEEPSEEK_MODEL || "deepseek-v4-flash" });
  } catch (error) {
    console.warn("[explain] AI explanation fallback:", error instanceof Error ? error.message : "unknown error");
    return Response.json({ explanation: null, mode: "deterministic" });
  }
}

function resolveChatCompletionsUrl(base = "https://api.deepseek.com") {
  const normalized = base.trim().replace(/\/+$/, "");
  return normalized.endsWith("/chat/completions") ? normalized : `${normalized}/chat/completions`;
}

function resolveTimeoutMs(value: string | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(60000, Math.max(5000, parsed)) : 45000;
}

function parseJsonObject(content: string) {
  const unfenced = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = unfenced.indexOf("{"); const end = unfenced.lastIndexOf("}");
  return JSON.parse(start >= 0 && end > start ? unfenced.slice(start, end + 1) : unfenced);
}

function clean(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
