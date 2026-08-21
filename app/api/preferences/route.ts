import { extractWithRules, type DecisionKind, type HardConstraint, type HardConstraintType, type PreferenceExtraction, type SoftPreference, type SoftPreferenceFeature } from "../../../lib/couju";

export const dynamic = "force-dynamic";

const hardTypes = new Set<HardConstraintType>(["arrival_after", "leave_before", "max_budget", "no_spicy", "allergy"]);
const softFeatures = new Set<SoftPreferenceFeature>(["quiet", "conversation", "indoor", "outdoor", "queue_time", "price"]);

export async function POST(request: Request) {
  let body: { note?: unknown; kind?: unknown; city?: unknown; date?: unknown; startTime?: unknown; endTime?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "请求内容不是有效 JSON" }, { status: 400 });
  }

  const note = typeof body.note === "string" ? body.note.trim().slice(0, 500) : "";
  const kind: DecisionKind = body.kind === "dining" ? "dining" : "activity";
  if (!note) return Response.json({ error: "请先输入一句偏好" }, { status: 400 });

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return Response.json({ extraction: { ...extractWithRules(note, kind), warning: "未配置 DeepSeek Key，已使用本地规则抽取。" } });
  }

  const prompt = buildPrompt({
    note,
    kind,
    city: typeof body.city === "string" ? body.city : "上海",
    date: typeof body.date === "string" ? body.date : "",
    startTime: typeof body.startTime === "string" ? body.startTime : "",
    endTime: typeof body.endTime === "string" ? body.endTime : "",
  });

  try {
    const response = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: process.env.DEEPSEEK_MODEL || "deepseek-v4-flash",
        thinking: { type: "disabled" },
        messages: [
          { role: "system", content: "你是凑局的偏好字段抽取器。只输出 JSON，不推荐地点，不补造用户未说过的事实。" },
          { role: "user", content: prompt },
        ],
        response_format: { type: "json_object" },
        max_tokens: 1200,
        temperature: 0.1,
      }),
      signal: AbortSignal.timeout(9000),
    });
    if (!response.ok) throw new Error(`DeepSeek ${response.status}`);
    const payload = await response.json() as { choices?: Array<{ finish_reason?: string; message?: { content?: string } }>; model?: string };
    const content = payload.choices?.[0]?.message?.content;
    if (!content || payload.choices?.[0]?.finish_reason === "length") throw new Error("DeepSeek returned empty or truncated JSON");
    const extraction = normalizeExtraction(JSON.parse(content), payload.model || process.env.DEEPSEEK_MODEL || "deepseek-v4-flash");
    return Response.json({ extraction });
  } catch {
    const fallback = extractWithRules(note, kind);
    return Response.json({ extraction: { ...fallback, warning: "DeepSeek 暂时不可用，已自动切换为本地规则抽取。" } });
  }
}

function buildPrompt(input: { note: string; kind: DecisionKind; city: string; date: string; startTime: string; endTime: string }) {
  return `请把用户输入转换为以下结构的 JSON：
{
  "hard_constraints": [{"type":"arrival_after|leave_before|max_budget|no_spicy|allergy","value":"string","confidence":0.0,"evidence":"原文证据","label":"给用户看的短标签"}],
  "soft_preferences": [{"feature":"quiet|conversation|indoor|outdoor|queue_time|price","direction":"maximize|minimize","weight":0.0,"confidence":0.0,"evidence":"原文证据","label":"给用户看的短标签"}],
  "needs_confirmation": true,
  "clarification_question": null
}
规则：只有“必须、不能、最晚、过敏、预算上限”等明确底线才放 hard_constraints；“最好、希望、不想、尽量”放 soft_preferences；时间统一为 HH:mm；不要推断用户没说过的信息；不适用的数组返回 []。
场景：${input.kind === "dining" ? "聚餐" : "活动"}
城市：${input.city}
日期：${input.date}
房间时间：${input.startTime}-${input.endTime}
用户输入：${input.note}`;
}

function normalizeExtraction(raw: unknown, model: string): PreferenceExtraction {
  if (!raw || typeof raw !== "object") throw new Error("invalid extraction");
  const value = raw as Record<string, unknown>;
  const hardConstraints: HardConstraint[] = Array.isArray(value.hard_constraints)
    ? value.hard_constraints.flatMap((item, index) => normalizeHard(item, index))
    : [];
  const softPreferences: SoftPreference[] = Array.isArray(value.soft_preferences)
    ? value.soft_preferences.flatMap((item, index) => normalizeSoft(item, index))
    : [];
  return {
    mode: "deepseek",
    model,
    hardConstraints,
    softPreferences,
    needsConfirmation: value.needs_confirmation !== false,
    clarificationQuestion: typeof value.clarification_question === "string" ? value.clarification_question.slice(0, 120) : null,
    extractedAt: new Date().toISOString(),
  };
}

function normalizeHard(item: unknown, index: number): HardConstraint[] {
  if (!item || typeof item !== "object") return [];
  const value = item as Record<string, unknown>;
  if (typeof value.type !== "string" || !hardTypes.has(value.type as HardConstraintType) || typeof value.value !== "string") return [];
  return [{
    id: `deepseek-hard-${index}`,
    type: value.type as HardConstraintType,
    value: value.value.slice(0, 80),
    confidence: numberBetween(value.confidence, 0, 1, 0.7),
    evidence: typeof value.evidence === "string" ? value.evidence.slice(0, 120) : "",
    label: typeof value.label === "string" ? value.label.slice(0, 30) : value.value.slice(0, 30),
  }];
}

function normalizeSoft(item: unknown, index: number): SoftPreference[] {
  if (!item || typeof item !== "object") return [];
  const value = item as Record<string, unknown>;
  if (typeof value.feature !== "string" || !softFeatures.has(value.feature as SoftPreferenceFeature)) return [];
  return [{
    id: `deepseek-soft-${index}`,
    feature: value.feature as SoftPreferenceFeature,
    direction: value.direction === "minimize" ? "minimize" : "maximize",
    weight: numberBetween(value.weight, 0, 1, 0.6),
    confidence: numberBetween(value.confidence, 0, 1, 0.7),
    evidence: typeof value.evidence === "string" ? value.evidence.slice(0, 120) : "",
    label: typeof value.label === "string" ? value.label.slice(0, 30) : value.feature,
  }];
}

function numberBetween(value: unknown, min: number, max: number, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}
