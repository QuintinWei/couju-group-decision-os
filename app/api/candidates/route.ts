import { ACTIVITY_INTERESTS, DEFAULT_INTERESTS, DINING_INTERESTS, estimateTravelBetween, estimateTravelMinutes, getDemoCandidates, SUPPORTED_CITIES, type Candidate, type CityName, type DecisionKind } from "../../../lib/couju";

export const dynamic = "force-dynamic";

type AmapPoi = {
  id?: string;
  name?: string;
  type?: string;
  address?: string | string[];
  location?: string;
  adname?: string;
  business?: { cost?: string; rating?: string; opentime_today?: string; business_area?: string; tag?: string };
  photos?: Array<{ url?: string }>;
};

export async function GET(request: Request) {
  const url = new URL(request.url);
  const city = SUPPORTED_CITIES.includes(url.searchParams.get("city") as CityName) ? url.searchParams.get("city") as CityName : "上海";
  const kind: DecisionKind = url.searchParams.get("kind") === "dining" ? "dining" : "activity";
  const allowed = new Set<string>(kind === "dining" ? DINING_INTERESTS : ACTIVITY_INTERESTS);
  const requested = (url.searchParams.get("interests") || "").split(",").map((item) => item.trim()).filter((item) => allowed.has(item));
  const seed = (url.searchParams.get("seed") || crypto.randomUUID()).slice(0, 80);
  const discoveryPool = stableShuffle(DEFAULT_INTERESTS[kind], seed);
  const strategy = url.searchParams.get("strategy") === "focused" ? "focused" : url.searchParams.get("strategy") === "learn" ? "learn" : "explore";
  const focused = strategy === "focused" && requested.length > 0;
  const interests = [...new Set(focused ? requested : [...requested, ...discoveryPool])].slice(0, kind === "activity" ? 8 : 7);
  const avoidTokens = (url.searchParams.get("avoid") || "").split(/[\s,，、;；]+/).map((item) => item.trim()).filter((item) => item.length >= 2).slice(0, 8);
  const excludedIds = new Set((url.searchParams.get("exclude") || "").split(",").map((item) => item.replace(/^amap-/, "").trim()).filter(Boolean).slice(0, 40));
  const page = Math.min(5, Math.max(1, Number(url.searchParams.get("page")) || 1));
  const location = parseLocation(url.searchParams.get("location"));
  const key = process.env.AMAP_WEB_SERVICE_KEY;
  if (!key) return demoResponse(city, kind, interests, seed, focused, strategy, "未配置高德 Web 服务 Key，当前展示带明确标识的演示候选。", 200);

  try {
    const resultSets = await Promise.all(interests.map((interest) => searchAmap({ key, city, kind, interest, location, page })));
    const candidates = diversify(resultSets, city, kind, avoidTokens, excludedIds, location).slice(0, 12);
    if (candidates.length < 4) throw new Error("Not enough usable POIs");
    return Response.json({
      candidates,
      meta: { mode: "live", label: focused ? "按想法探索" : strategy === "learn" ? "根据划卡换一批" : "随机发现", fetchedAt: new Date().toISOString(), city, kind, keywords: interests, avoid: avoidTokens, page, center: location, seed, focused, strategy, disclaimer: focused ? "按你主动选择的类型召回，并保留类别多样性。" : strategy === "learn" ? "参考喜欢与不喜欢，仍保留新的跨类别发现。" : "跨类别随机发现；出发地只用于附近优先，不会锁死候选。" },
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return demoResponse(city, kind, interests, seed, focused, strategy, "高德地点服务暂时不可用，已切换为演示候选。", 200);
  }
}

async function searchAmap(input: { key: string; city: CityName; kind: DecisionKind; interest: string; location: { lng: number; lat: number } | null; page: number }) {
  const params = new URLSearchParams({
    key: input.key,
    keywords: input.interest,
    show_fields: "business,photos",
    page_size: "6",
    page_num: String(input.page),
    output: "json",
  });
  if (input.kind === "dining") params.set("types", "050000");
  if (input.location) {
    params.set("location", `${input.location.lng},${input.location.lat}`);
    params.set("radius", "18000");
    params.set("sortrule", "weight");
  } else {
    params.set("region", `${input.city}市`);
    params.set("city_limit", "true");
  }
  const endpoint = input.location ? "around" : "text";
  const response = await fetch(`https://restapi.amap.com/v5/place/${endpoint}?${params}`, { signal: AbortSignal.timeout(9000) });
  if (!response.ok) return { interest: input.interest, pois: [] as AmapPoi[] };
  const payload = await response.json() as { status?: string; pois?: AmapPoi[] };
  return { interest: input.interest, pois: payload.status === "1" && Array.isArray(payload.pois) ? payload.pois : [] };
}

function diversify(resultSets: Array<{ interest: string; pois: AmapPoi[] }>, city: CityName, kind: DecisionKind, avoidTokens: string[], excludedIds: Set<string>, center: { lng: number; lat: number } | null) {
  const seen = new Set<string>(); const candidates: Candidate[] = [];
  const maxDepth = Math.max(0, ...resultSets.map((set) => set.pois.length));
  for (let depth = 0; depth < maxDepth; depth += 1) {
    for (const result of resultSets) {
      const poi = result.pois[depth];
      if (!poi?.id || seen.has(poi.id) || excludedIds.has(poi.id)) continue;
      const searchable = `${poi.name || ""} ${poi.type || ""} ${poi.business?.tag || ""}`;
      if (avoidTokens.some((token) => searchable.includes(token))) continue;
      if (kind === "activity" && /景区|景点|公园|古镇|纪念馆|旅游区|风景名胜/.test(searchable)) continue;
      const mapped = mapPoi(poi, city, kind, candidates.length, result.interest, center);
      if (mapped.length) { seen.add(poi.id); candidates.push(mapped[0]); }
    }
  }
  return candidates;
}

function mapPoi(poi: AmapPoi, city: CityName, kind: DecisionKind, index: number, matchedInterest: string, center: { lng: number; lat: number } | null): Candidate[] {
  if (!poi.id || !poi.name) return [];
  const [lng, lat] = typeof poi.location === "string" ? poi.location.split(",").map(Number) : [NaN, NaN];
  const location = Number.isFinite(lng) && Number.isFinite(lat) ? { lng, lat } : null;
  const price = finiteNumber(poi.business?.cost);
  const rating = finiteNumber(poi.business?.rating);
  const type = poi.type?.split(";").at(-1) || (kind === "dining" ? "餐饮" : "休闲活动");
  const fallbackImages = kind === "dining"
    ? ["food-yunnan", "food-hotpot", "food-sushi", "food-bbq", "food-brunch", "food-vegetarian", "food-dimsum", "food-noodle"]
    : [fallbackActivityImage(matchedInterest), "activity-boardgame", "activity-escape", "activity-pottery", "activity-climb"];
  const photo = poi.photos?.find((item) => typeof item.url === "string")?.url;
  const tag = poi.business?.tag || type;
  const address = Array.isArray(poi.address) ? poi.address.join("") : poi.address || "地址待确认";
  const markerUrl = location
    ? `https://uri.amap.com/marker?position=${location.lng},${location.lat}&name=${encodeURIComponent(poi.name)}&coordinate=gaode&callnative=0`
    : `https://uri.amap.com/search?keyword=${encodeURIComponent(city + poi.name)}`;
  return [{
    id: `amap-${poi.id}`,
    kind,
    city,
    type,
    name: poi.name,
    meta: `${matchedInterest} · ${tag}`,
    matchedInterest,
    image: photo || `/candidates/${fallbackImages[index % fallbackImages.length]}.jpg`,
    priceValue: price,
    priceLabel: price === null ? "价格待确认" : `¥${Math.round(price)}/人`,
    durationMinutes: kind === "dining" ? 120 : 150,
    durationLabel: kind === "dining" ? "建议预留 2 小时" : "建议预留 2.5 小时",
    address,
    district: poi.adname || poi.business?.business_area || "城区",
    location,
    estimatedTravelMinutes: estimateTravelBetween(center, location) ?? estimateTravelMinutes(city, location),
    rating,
    openToday: poi.business?.opentime_today || null,
    source: { mode: "live", label: "高德地图 POI", fetchedAt: new Date().toISOString(), providerId: poi.id, url: markerUrl },
    features: {
      indoor: kind === "dining" ? true : null,
      quiet: /安静|书店|美术馆|博物馆/.test(tag + poi.name) ? true : null,
      conversationFriendly: /聚会|朋友|茶|咖啡|餐厅/.test(tag + type) ? true : null,
      nonSpicyAvailable: /不辣|清淡|素食|粤菜|日料/.test(tag + type) ? true : null,
      queueRisk: null,
    },
  }];
}

function fallbackActivityImage(interest: string) {
  if (/攀岩|羽毛球|保龄球/.test(interest)) return "activity-climb";
  if (/陶艺|拼豆/.test(interest)) return "activity-pottery";
  if (/剧本杀|密室/.test(interest)) return "activity-escape";
  if (/电影|展览|脱口秀/.test(interest)) return "activity-museum";
  if (/KTV|麻将|桌游/.test(interest)) return "activity-boardgame";
  return "activity-brunch";
}

function parseLocation(value: string | null) {
  if (!value) return null;
  const [lng, lat] = value.split(",").map(Number);
  return Number.isFinite(lng) && Number.isFinite(lat) && lng >= -180 && lng <= 180 && lat >= -90 && lat <= 90 ? { lng, lat } : null;
}

function demoResponse(city: CityName, kind: DecisionKind, interests: string[], seed: string, focused: boolean, strategy: "explore" | "focused" | "learn", disclaimer: string, status: number) {
  const matching = getDemoCandidates(city, kind).map((candidate) => ({ ...candidate, matchedInterest: candidate.type }));
  const filtered = focused ? matching.filter((candidate) => interests.some((interest) => candidate.type.includes(interest) || interest.includes(candidate.type))) : matching;
  const candidates = stableShuffle(filtered.length >= 4 ? filtered : matching, seed);
  return Response.json({
    candidates,
    meta: { mode: "demo", label: focused ? "按想法探索 · 演示" : strategy === "learn" ? "根据划卡换一批 · 演示" : "随机发现 · 演示", fetchedAt: "2026-08-21T00:00:00.000Z", city, kind, keywords: interests, page: 1, center: null, seed, focused, strategy, disclaimer },
  }, { status, headers: { "Cache-Control": "no-store" } });
}

function stableShuffle<T>(values: readonly T[], seed: string) {
  const result = [...values];
  let state = 2166136261;
  for (const char of seed) state = Math.imul(state ^ char.charCodeAt(0), 16777619) >>> 0;
  for (let index = result.length - 1; index > 0; index -= 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const swap = state % (index + 1);
    [result[index], result[swap]] = [result[swap], result[index]];
  }
  return result;
}

function finiteNumber(value: string | undefined): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}
