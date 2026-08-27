import { ACTIVITY_INTERESTS, DEFAULT_INTERESTS, DINING_INTERESTS, estimateTravelBetween, estimateTravelMinutes, extractWithRules, getDemoCandidates, rankGroupCandidates, SUPPORTED_CITIES, type Candidate, type CityName, type DecisionKind, type RoomConfig } from "../../../lib/couju";
import { amapPagesForBatch, selectCandidateBatch } from "../../../lib/candidate-pool";
import { withAmapCache } from "../../../lib/amap-cache";
import { buildAmapPlaceSearchUrl } from "../../../lib/amap-place-search";

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
  const strategy = parseStrategy(url.searchParams.get("strategy"));
  const privateMode = strategy === "private";
  const requestedLimit = Number(url.searchParams.get("limit"));
  if (privateMode && requestedLimit !== 3) return Response.json({ error: "私人发现固定返回三张候选" }, { status: 400 });
  const targetCount = privateMode ? 3 : 12;
  const focused = strategy === "focused" && requested.length > 0;
  const avoidTokens = (url.searchParams.get("avoid") || "").split(/[\s,，、;；]+/).map((item) => item.trim()).filter((item) => item.length >= 2).slice(0, 8);
  const excludedIds = new Set((url.searchParams.get("exclude") || "").split(",").map((item) => item.replace(/^amap-/, "").trim()).filter(Boolean).slice(0, 120));
  const unseenTypes = new Set((url.searchParams.get("unseen") || "").split(",").map((item) => item.trim()).filter(Boolean).slice(0, 20));
  const requestedExploreTypes = new Set((url.searchParams.get("explore") || "").split(",").map((item) => item.trim()).filter((item) => allowed.has(item)).slice(0, 20));
  const explorationTypes = requestedExploreTypes.size ? requestedExploreTypes : unseenTypes;
  const learnedScores = parseLearnedScores(url.searchParams.get("scores"), allowed);
  const strategyInterests = strategy === "learn" ? [...learnedScores.keys(), ...requested] : strategy === "explore" ? [...explorationTypes, ...requested] : requested;
  const interests = [...new Set(focused ? requested : [...strategyInterests, ...discoveryPool])].slice(0, kind === "activity" ? 8 : 7);
  const setting = url.searchParams.get("setting")?.trim().slice(0, 24) || "";
  const page = Math.min(5, Math.max(1, Number(url.searchParams.get("page")) || 1));
  const batchIndex = Math.max(0, Number(url.searchParams.get("batch")) || page - 1);
  const location = parseLocation(url.searchParams.get("location"));
  const privateRanking = privateMode ? parsePrivateRanking(url, city, kind, location, setting) : null;
  const key = process.env.AMAP_WEB_SERVICE_KEY;
  if (!key) return demoResponse(city, kind, interests, seed, focused, strategy, location, excludedIds, targetCount, setting, explorationTypes, learnedScores, privateRanking, "未配置高德 Web 服务 Key，当前展示带明确标识的演示候选。", 200);

  try {
    const pages = privateMode ? [page] : amapPagesForBatch(batchIndex);
    const resultSets = await Promise.all(interests.flatMap((interest) => pages.map((pageNumber) => searchAmap({ key, city, kind, interest, page: pageNumber, center: location }))));
    const pricedCandidates = diversify(resultSets, city, kind, avoidTokens, excludedIds, location).filter((candidate) => candidate.priceValue !== null);
    const prioritized = prioritizeStrategy(pricedCandidates, strategy, interests, explorationTypes, learnedScores, privateRanking);
    const candidates = privateMode ? prioritized.slice(0, targetCount) : selectCandidateBatch(prioritized, { excludedIds, batchSize: targetCount, seed, kind });
    if (candidates.length !== targetCount || !hasUniqueProviderIds(candidates)) throw new Error("Not enough usable POIs");
    return Response.json({
      candidates,
      meta: { mode: "live", label: candidateLabel({ focused, strategy, mode: "live", hasUnseenPriority: unseenTypes.size > 0, hasExplorationPriority: requestedExploreTypes.size > 0, hasFeedback: learnedScores.size > 0 }), fetchedAt: new Date().toISOString(), city, kind, keywords: interests, avoid: avoidTokens, page: pages[0], center: location, seed, focused, strategy, disclaimer: "候选从全城分类型召回；每位成员的出发地与通勤上限只在最终计算时单独过滤。" },
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return demoResponse(city, kind, interests, seed, focused, strategy, location, excludedIds, targetCount, setting, explorationTypes, learnedScores, privateRanking, "高德地点服务暂时不可用，已切换为演示候选。", 200);
  }
}

async function searchAmap(input: { key: string; city: CityName; kind: DecisionKind; interest: string; page: number; center: { lng: number; lat: number } | null }) {
  const cached = await withAmapCache<AmapPoi>(
    { city: input.city, kind: input.kind, interest: input.interest, page: input.page, center: input.center },
    () => fetchAmapPois(input),
  );
  return { interest: input.interest, pois: cached.pois, fetchedAt: cached.fetchedAt };
}

async function fetchAmapPois(input: { key: string; city: CityName; kind: DecisionKind; interest: string; page: number; center: { lng: number; lat: number } | null }): Promise<AmapPoi[]> {
  const response = await fetch(buildAmapPlaceSearchUrl(input), { signal: AbortSignal.timeout(9000) });
  if (!response.ok) return [];
  const payload = await response.json() as { status?: string; pois?: AmapPoi[] };
  return payload.status === "1" && Array.isArray(payload.pois) ? payload.pois : [];
}

function diversify(resultSets: Array<{ interest: string; pois: AmapPoi[]; fetchedAt: string }>, city: CityName, kind: DecisionKind, avoidTokens: string[], excludedIds: Set<string>, center: { lng: number; lat: number } | null) {
  const seen = new Set<string>(); const candidates: Candidate[] = [];
  const maxDepth = Math.max(0, ...resultSets.map((set) => set.pois.length));
  for (let depth = 0; depth < maxDepth; depth += 1) {
    for (const result of resultSets) {
      const poi = result.pois[depth];
      if (!poi?.id || seen.has(poi.id) || excludedIds.has(poi.id)) continue;
      const searchable = `${poi.name || ""} ${poi.type || ""} ${poi.business?.tag || ""}`;
      if (avoidTokens.some((token) => searchable.includes(token))) continue;
      const mapped = mapPoi(poi, city, kind, candidates.length, result.interest, center, result.fetchedAt);
      if (mapped.length) { seen.add(poi.id); candidates.push(mapped[0]); }
    }
  }
  return candidates;
}

function mapPoi(poi: AmapPoi, city: CityName, kind: DecisionKind, index: number, matchedInterest: string, center: { lng: number; lat: number } | null, fetchedAt: string): Candidate[] {
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
    source: { mode: "live", label: "高德地图 POI", fetchedAt, providerId: poi.id, url: markerUrl },
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
  if (/景点/.test(interest)) return "activity-camp";
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

function demoResponse(city: CityName, kind: DecisionKind, interests: string[], seed: string, focused: boolean, strategy: CandidateStrategy, center: { lng: number; lat: number } | null, excludedIds: Set<string>, targetCount: number, setting: string, explorationTypes: Set<string>, learnedScores: Map<string, number>, privateRanking: PrivateRankingInput | null, disclaimer: string, status: number) {
  const matching = getDemoCandidates(city, kind).map((candidate) => ({ ...candidate, matchedInterest: candidate.type }));
  const focusedCandidates = focused ? matching.filter((candidate) => interests.some((interest) => matchesInterest(candidate, [interest]))) : matching;
  const unexcluded = focusedCandidates.filter((candidate) => !excludedIds.has(candidate.id) && !excludedIds.has(candidate.source.providerId || candidate.id));
  const shuffled = stableShuffle(unexcluded, seed);
  const prioritized = prioritizeStrategy(shuffled, strategy, interests, explorationTypes, learnedScores, privateRanking ?? (strategy === "private" ? defaultPrivateRanking(city, kind, center, setting) : null));
  const candidates = strategy === "private" ? prioritized.slice(0, targetCount) : takeDiverseCandidates(prioritized, targetCount);
  if (candidates.length !== targetCount || !hasUniqueProviderIds(candidates)) return Response.json({ error: strategy === "private" ? "私人发现候选不足，请稍后再试" : "共享候选不足 12 张，请稍后再试" }, { status: 422, headers: { "Cache-Control": "no-store" } });
  return Response.json({
    candidates,
    meta: { mode: "demo", label: candidateLabel({ focused, strategy, mode: "demo", hasUnseenPriority: false, hasExplorationPriority: explorationTypes.size > 0, hasFeedback: learnedScores.size > 0 }), fetchedAt: "2026-08-21T00:00:00.000Z", city, kind, keywords: interests, page: 1, center, seed, focused, strategy, disclaimer },
  }, { status, headers: { "Cache-Control": "no-store" } });
}

type CandidateStrategy = "explore" | "focused" | "learn" | "private";

function parseStrategy(value: string | null): CandidateStrategy {
  if (value === "focused" || value === "learn" || value === "private") return value;
  return "explore";
}

function candidateLabel(input: { focused: boolean; strategy: CandidateStrategy; mode: "live" | "demo"; hasUnseenPriority: boolean; hasExplorationPriority: boolean; hasFeedback: boolean }) {
  const base = input.strategy === "private" ? "私人发现" : input.focused ? "按想法探索" : input.strategy === "learn" ? input.hasFeedback ? "按群体反馈探索" : "根据结果换一批" : input.hasUnseenPriority ? "按未探索类型发现" : input.hasExplorationPriority ? "按其他类型探索" : "随机发现";
  return input.mode === "demo" ? `${base} · 演示` : base;
}

type PrivateRankingInput = {
  config: RoomConfig;
  originLocation: { lng: number; lat: number } | null;
  budgetLabel: string;
  commuteLabel: string;
  setting: string;
  note: string;
};

function parsePrivateRanking(url: URL, city: CityName, kind: DecisionKind, originLocation: { lng: number; lat: number } | null, setting: string): PrivateRankingInput {
  const date = url.searchParams.get("date") || "2026-08-24";
  const startTime = url.searchParams.get("startTime") || "18:00";
  const endTime = url.searchParams.get("endTime") || "21:30";
  return {
    config: { city, kind, dateRange: { start: date, end: date }, preferredPeriods: ["evening"], durationMinutes: null, resolvedSchedule: { startAt: `${date}T${startTime}:00+08:00`, endAt: `${date}T${endTime}:00+08:00`, attendeeIds: ["private-member"] }, date, startTime, endTime, people: 1 },
    originLocation,
    budgetLabel: url.searchParams.get("budget")?.trim().slice(0, 24) || "不限",
    commuteLabel: url.searchParams.get("commute")?.trim().slice(0, 24) || "不限",
    setting,
    note: url.searchParams.get("note")?.trim().slice(0, 500) || "",
  };
}

function defaultPrivateRanking(city: CityName, kind: DecisionKind, originLocation: { lng: number; lat: number } | null, setting: string): PrivateRankingInput {
  return parsePrivateRanking(new URL(`https://couju.local/?setting=${encodeURIComponent(setting)}`), city, kind, originLocation, setting);
}

function prioritizeStrategy(candidates: Candidate[], strategy: CandidateStrategy, interests: string[], explorationTypes: Set<string>, learnedScores: Map<string, number>, privateRanking: PrivateRankingInput | null) {
  if (strategy === "private" && privateRanking) return prioritizePrivate(candidates, explorationTypes, privateRanking);
  if (strategy === "learn") return prioritizeLearned(candidates, learnedScores, interests);
  if (strategy === "explore") return prioritizeUnseen(candidates, explorationTypes);
  return candidates;
}

function prioritizePrivate(candidates: Candidate[], unseenTypes: Set<string>, input: PrivateRankingInput) {
  const ranked = rankGroupCandidates(candidates, [{
    id: "private-member", name: "私人发现", origin: "", originLocation: input.originLocation,
    budgetLabel: input.budgetLabel, commuteLabel: input.commuteLabel, setting: input.setting || "都可以", note: input.note,
    extraction: input.note ? extractWithRules(input.note, input.config.kind) : null, choices: {}, submittedAt: new Date().toISOString(),
  }], input.config);
  return [...ranked].sort((left, right) => Number(isUnseen(right, unseenTypes)) - Number(isUnseen(left, unseenTypes)) || right.groupFit - left.groupFit);
}

function prioritizeLearned(candidates: Candidate[], learnedScores: Map<string, number>, interests: string[]) {
  return [...candidates].sort((left, right) => learnedScore(right, learnedScores, interests) - learnedScore(left, learnedScores, interests));
}

function prioritizeUnseen(candidates: Candidate[], unseenTypes: Set<string>) {
  return [...candidates].sort((left, right) => Number(isUnseen(right, unseenTypes)) - Number(isUnseen(left, unseenTypes)));
}

function takeDiverseCandidates(candidates: Candidate[], targetCount: number) {
  const queues = new Map<string, Candidate[]>();
  for (const candidate of candidates) {
    const key = candidate.matchedInterest || candidate.type;
    queues.set(key, [...(queues.get(key) ?? []), candidate]);
  }
  const result: Candidate[] = [];
  while (result.length < targetCount) {
    let added = false;
    for (const queue of queues.values()) {
      const candidate = queue.shift();
      if (!candidate) continue;
      result.push(candidate);
      added = true;
      if (result.length === targetCount) break;
    }
    if (!added) break;
  }
  return result;
}

function matchesInterest(candidate: Candidate, interests: string[]) {
  return interests.some((interest) => [candidate.matchedInterest, candidate.type].some((category) => Boolean(category && (category.includes(interest) || interest.includes(category)))));
}

function isUnseen(candidate: Candidate, unseenTypes: Set<string>) {
  return unseenTypes.has(candidate.type) || Boolean(candidate.matchedInterest && unseenTypes.has(candidate.matchedInterest));
}

function learnedScore(candidate: Candidate, scores: Map<string, number>, interests: string[]) {
  const category = candidate.matchedInterest || candidate.type;
  if (scores.has(category)) return scores.get(category) ?? 0;
  return matchesInterest(candidate, interests) ? 0.1 : 0;
}

function parseLearnedScores(value: string | null, allowed: Set<string>) {
  const scores = new Map<string, number>();
  for (const item of (value || "").split(",").slice(0, 20)) {
    const separator = item.lastIndexOf(":");
    if (separator < 1) continue;
    const category = item.slice(0, separator).trim();
    const score = Number(item.slice(separator + 1));
    if (!allowed.has(category) || !Number.isFinite(score)) continue;
    scores.set(category, score);
  }
  return scores;
}

function hasUniqueProviderIds(candidates: Candidate[]) {
  const ids = candidates.map((candidate) => candidate.source.providerId || candidate.id);
  return new Set(ids).size === ids.length;
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
