export type Stage = "home" | "create" | "room" | "swipe" | "constraints" | "ranking" | "results" | "locked";
export type Choice = "no" | "okay" | "like";
export type DecisionKind = "activity" | "dining";
export type DataMode = "live" | "demo";
export type ExtractionMode = "deepseek" | "rules";

export const CITY_PROFILES = {
  上海: { area: "静安区", center: [121.4737, 31.2304], districts: ["静安区", "黄浦区", "徐汇区", "长宁区", "浦东新区"] },
  北京: { area: "朝阳区", center: [116.4074, 39.9042], districts: ["朝阳区", "东城区", "西城区", "海淀区", "丰台区"] },
  深圳: { area: "南山区", center: [114.0579, 22.5431], districts: ["南山区", "福田区", "罗湖区", "宝安区", "龙岗区"] },
  杭州: { area: "上城区", center: [120.1551, 30.2741], districts: ["上城区", "西湖区", "拱墅区", "滨江区", "余杭区"] },
  成都: { area: "锦江区", center: [104.0665, 30.5723], districts: ["锦江区", "武侯区", "青羊区", "成华区", "高新区"] },
  广州: { area: "天河区", center: [113.2644, 23.1291], districts: ["天河区", "越秀区", "海珠区", "荔湾区", "番禺区"] },
} as const;

export type CityName = keyof typeof CITY_PROFILES;
export const SUPPORTED_CITIES = Object.keys(CITY_PROFILES) as CityName[];

export type RoomConfig = {
  kind: DecisionKind;
  city: CityName;
  date: string;
  startTime: string;
  endTime: string;
  people: number;
};

export type Candidate = {
  id: string;
  kind: DecisionKind;
  city: CityName;
  type: string;
  name: string;
  meta: string;
  image: string;
  priceValue: number | null;
  priceLabel: string;
  durationMinutes: number;
  durationLabel: string;
  address: string;
  district: string;
  location: { lng: number; lat: number } | null;
  estimatedTravelMinutes: number | null;
  rating: number | null;
  openToday: string | null;
  source: {
    mode: DataMode;
    label: string;
    fetchedAt: string;
    providerId?: string;
    url?: string;
  };
  features: {
    indoor: boolean | null;
    quiet: boolean | null;
    conversationFriendly: boolean | null;
    nonSpicyAvailable: boolean | null;
    queueRisk: "low" | "medium" | "high" | null;
  };
};

export type HardConstraintType = "arrival_after" | "leave_before" | "max_budget" | "no_spicy" | "allergy";
export type SoftPreferenceFeature = "quiet" | "conversation" | "indoor" | "outdoor" | "queue_time" | "price";

export type HardConstraint = {
  id: string;
  type: HardConstraintType;
  value: string;
  confidence: number;
  evidence: string;
  label: string;
};

export type SoftPreference = {
  id: string;
  feature: SoftPreferenceFeature;
  direction: "maximize" | "minimize";
  weight: number;
  confidence: number;
  evidence: string;
  label: string;
};

export type PreferenceExtraction = {
  mode: ExtractionMode;
  model: string | null;
  hardConstraints: HardConstraint[];
  softPreferences: SoftPreference[];
  needsConfirmation: boolean;
  clarificationQuestion: string | null;
  extractedAt: string;
  warning?: string;
};

export type RankContext = {
  config: RoomConfig;
  choices: Record<string, Choice>;
  budgetLabel: string;
  commuteLabel: string;
  setting: string;
  extraction: PreferenceExtraction | null;
  excludedIds?: string[];
  vetoReason?: string;
};

export type RankedCandidate = Candidate & {
  groupFit: number;
  minUtility: number;
  meanUtility: number;
  geoMean: number;
  uncertainty: number;
  userUtility: number;
  evidence: string[];
  unknownFacts: string[];
  explanation: string;
};

type DemoTemplate = Omit<Candidate, "city" | "district" | "address" | "source" | "location"> & { travel: number };

const activityTemplates: DemoTemplate[] = [
  demo("kart", "activity", "刺激体验", "极速卡丁车馆", "室内赛道 · 新手友好", "/candidates/activity-kart.jpg", 178, 120, 28, { indoor: true, quiet: false, conversationFriendly: false, nonSpicyAvailable: null, queueRisk: "medium" }),
  demo("museum", "activity", "文化艺术", "当代艺术中心", "新展开放 · 建议提前预约", "/candidates/activity-museum.jpg", 100, 150, 24, { indoor: true, quiet: true, conversationFriendly: true, nonSpicyAvailable: null, queueRisk: "low" }),
  demo("camp", "activity", "户外放松", "城市滨江轻露营", "装备与茶点需二次确认", "/candidates/activity-camp.jpg", 126, 180, 38, { indoor: false, quiet: true, conversationFriendly: true, nonSpicyAvailable: null, queueRisk: "low" }),
  demo("game", "activity", "轻松社交", "META 桌游社", "桌游教学 · 适合多人", "/candidates/activity-boardgame.jpg", 88, 180, 20, { indoor: true, quiet: false, conversationFriendly: true, nonSpicyAvailable: null, queueRisk: "low" }),
  demo("escape", "activity", "沉浸解谜", "谜盒沉浸剧场", "轻恐主题 · 人数要求需确认", "/candidates/activity-escape.jpg", 168, 120, 32, { indoor: true, quiet: true, conversationFriendly: true, nonSpicyAvailable: null, queueRisk: "low" }),
  demo("pottery", "activity", "手作体验", "泥作陶艺工坊", "拉坯体验 · 作品可烧制", "/candidates/activity-pottery.jpg", 158, 120, 26, { indoor: true, quiet: true, conversationFriendly: true, nonSpicyAvailable: null, queueRisk: "low" }),
  demo("brunch", "activity", "轻食聚会", "梧桐树下 Brunch", "露台座位 · 宠物友好", "/candidates/activity-brunch.jpg", 138, 120, 22, { indoor: false, quiet: true, conversationFriendly: true, nonSpicyAvailable: true, queueRisk: "medium" }),
  demo("climb", "activity", "运动挑战", "岩时攀岩馆", "室内抱石 · 含基础教学", "/candidates/activity-climb.jpg", 198, 150, 42, { indoor: true, quiet: false, conversationFriendly: false, nonSpicyAvailable: null, queueRisk: "medium" }),
];

const diningTemplates: DemoTemplate[] = [
  demo("yunnan", "dining", "云南菜", "山野云南菜", "菌菇与汽锅鸡 · 可沟通不辣", "/candidates/food-yunnan.jpg", 148, 120, 28, { indoor: true, quiet: true, conversationFriendly: true, nonSpicyAvailable: true, queueRisk: "medium" }),
  demo("hotpot", "dining", "火锅", "巷里重庆火锅", "鸳鸯锅 · 适合多人分享", "/candidates/food-hotpot.jpg", 168, 120, 32, { indoor: true, quiet: false, conversationFriendly: true, nonSpicyAvailable: true, queueRisk: "high" }),
  demo("sushi", "dining", "日料", "鮨间小馆", "寿司拼盘 · 安静吧台", "/candidates/food-sushi.jpg", 218, 90, 24, { indoor: true, quiet: true, conversationFriendly: false, nonSpicyAvailable: true, queueRisk: "medium" }),
  demo("bbq", "dining", "炭火烤肉", "炭集烤肉", "店员代烤 · 包厢需确认", "/candidates/food-bbq.jpg", 188, 120, 36, { indoor: true, quiet: false, conversationFriendly: true, nonSpicyAvailable: true, queueRisk: "medium" }),
  demo("bistro", "dining", "西式简餐", "Common Table", "共享餐桌 · 适合聊天", "/candidates/food-brunch.jpg", 176, 120, 30, { indoor: true, quiet: true, conversationFriendly: true, nonSpicyAvailable: true, queueRisk: "medium" }),
  demo("veggie", "dining", "创意素食", "青苔蔬食厨房", "植物料理 · 安静好聊", "/candidates/food-vegetarian.jpg", 128, 90, 25, { indoor: true, quiet: true, conversationFriendly: true, nonSpicyAvailable: true, queueRisk: "low" }),
  demo("dimsum", "dining", "粤式点心", "喜粤茶楼", "全天点心 · 圆桌聚餐", "/candidates/food-dimsum.jpg", 118, 120, 22, { indoor: true, quiet: false, conversationFriendly: true, nonSpicyAvailable: true, queueRisk: "medium" }),
  demo("noodle", "dining", "面馆", "面里江湖", "手工面 · 性价比高", "/candidates/food-noodle.jpg", 68, 60, 18, { indoor: true, quiet: false, conversationFriendly: false, nonSpicyAvailable: true, queueRisk: "high" }),
];

function demo(
  id: string,
  kind: DecisionKind,
  type: string,
  name: string,
  meta: string,
  image: string,
  priceValue: number,
  durationMinutes: number,
  travel: number,
  features: Candidate["features"],
): DemoTemplate {
  return {
    id,
    kind,
    type,
    name,
    meta,
    image,
    priceValue,
    priceLabel: `¥${priceValue}/人`,
    durationMinutes,
    durationLabel: formatDuration(durationMinutes),
    estimatedTravelMinutes: travel,
    rating: null,
    openToday: null,
    features,
    travel,
  };
}

export function getDemoCandidates(city: CityName, kind: DecisionKind): Candidate[] {
  const profile = CITY_PROFILES[city];
  const templates = kind === "dining" ? diningTemplates : activityTemplates;
  return templates.map((item, index) => ({
    ...item,
    id: `${city}-${item.id}`,
    city,
    district: profile.districts[index % profile.districts.length],
    address: `${profile.districts[index % profile.districts.length]} · 演示地址不用于到店`,
    location: null,
    estimatedTravelMinutes: item.travel,
    source: {
      mode: "demo",
      label: "凑局演示候选库",
      fetchedAt: "2026-08-21T00:00:00.000Z",
    },
  }));
}

export function extractWithRules(note: string, kind: DecisionKind): PreferenceExtraction {
  const hardConstraints: HardConstraint[] = [];
  const softPreferences: SoftPreference[] = [];
  const text = note.trim();
  const timeMatches = [...text.matchAll(/(上午|中午|下午|晚上)?\s*(\d{1,2})(?:\s*[:点]\s*(\d{1,2})?分?)?\s*(以后|之后|后|以前|之前|前)/g)];

  for (const match of timeMatches) {
    let hour = Number(match[2]);
    const minute = Number(match[3] || 0);
    if ((match[1] === "下午" || match[1] === "晚上") && hour < 12) hour += 12;
    const value = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
    const after = ["以后", "之后", "后"].includes(match[4]);
    hardConstraints.push({
      id: `${after ? "arrival" : "leave"}-${hardConstraints.length}`,
      type: after ? "arrival_after" : "leave_before",
      value,
      confidence: 0.93,
      evidence: match[0],
      label: after ? `${value} 后到` : `${value} 前离开`,
    });
  }

  const budget = text.match(/(?:人均|预算|每人)[^\d]{0,6}(\d{2,4})/);
  if (budget) {
    hardConstraints.push({ id: "budget-note", type: "max_budget", value: budget[1], confidence: 0.88, evidence: budget[0], label: `人均 ≤ ¥${budget[1]}` });
  }
  if (kind === "dining" && /(不吃辣|不能吃辣|完全不辣|不要辣)/.test(text)) {
    hardConstraints.push({ id: "no-spicy", type: "no_spicy", value: "true", confidence: 0.96, evidence: text.match(/不吃辣|不能吃辣|完全不辣|不要辣/)?.[0] ?? "不吃辣", label: "不吃辣" });
  }
  const allergy = text.match(/(?:对|有)?([^，。,.]{1,8})(?:过敏|忌口)/);
  if (allergy) {
    hardConstraints.push({ id: "allergy", type: "allergy", value: allergy[1], confidence: 0.85, evidence: allergy[0], label: `${allergy[1]}过敏/忌口` });
  }

  addSoft(/安静|别太吵|不要太吵/, "quiet", "maximize", "安静一点");
  addSoft(/聊天|好好聊|交流/, "conversation", "maximize", "适合聊天");
  addSoft(/不排队|不想排队|少排队/, "queue_time", "minimize", "少排队");
  addSoft(/室内|怕下雨/, "indoor", "maximize", "室内优先");
  addSoft(/户外|晒太阳|露营/, "outdoor", "maximize", "户外优先");
  addSoft(/便宜|性价比|省钱/, "price", "minimize", "价格友好");

  function addSoft(pattern: RegExp, feature: SoftPreferenceFeature, direction: "maximize" | "minimize", label: string) {
    const match = text.match(pattern);
    if (!match) return;
    softPreferences.push({ id: `soft-${feature}`, feature, direction, weight: 0.7, confidence: 0.82, evidence: match[0], label });
  }

  return {
    mode: "rules",
    model: null,
    hardConstraints,
    softPreferences,
    needsConfirmation: hardConstraints.length > 0 || softPreferences.length > 0,
    clarificationQuestion: hardConstraints.some((item) => item.type === "allergy") ? "过敏或忌口信息会作为硬约束，请确认是否准确。" : null,
    extractedAt: new Date().toISOString(),
  };
}

export function rankCandidates(candidates: Candidate[], context: RankContext): RankedCandidate[] {
  const budget = mergeNumericLimit(parseLimit(context.budgetLabel), constraintNumber(context.extraction, "max_budget"));
  let commute = parseLimit(context.commuteLabel);
  if (context.vetoReason === "还是太远" && commute !== null) commute = Math.max(10, commute - 10);
  const start = Math.max(toMinutes(context.config.startTime), constraintTime(context.extraction, "arrival_after") ?? 0);
  const end = Math.min(toMinutes(context.config.endTime), constraintTime(context.extraction, "leave_before") ?? 24 * 60);
  const availableMinutes = Math.max(0, end - start);
  const noSpicy = context.setting === "不吃辣" || hasConstraint(context.extraction, "no_spicy");
  const excluded = new Set(context.excludedIds ?? []);

  return candidates
    .flatMap((candidate) => {
      const choice = context.choices[candidate.id];
      if (excluded.has(candidate.id) || choice === "no") return [];
      if (budget !== null && candidate.priceValue !== null && candidate.priceValue > budget) return [];
      if (commute !== null && candidate.estimatedTravelMinutes !== null && candidate.estimatedTravelMinutes > commute) return [];
      if (candidate.durationMinutes > availableMinutes) return [];
      if (noSpicy && candidate.features.nonSpicyAvailable === false) return [];

      const unknownFacts: string[] = [];
      if (budget !== null && candidate.priceValue === null) unknownFacts.push("人均价格");
      if (commute !== null && candidate.estimatedTravelMinutes === null) unknownFacts.push("通勤时间");
      if (noSpicy && candidate.features.nonSpicyAvailable === null) unknownFacts.push("不辣选项");
      if (candidate.source.mode === "live" && !candidate.openToday) unknownFacts.push("营业时间");
      if (hasConstraint(context.extraction, "allergy")) unknownFacts.push("过敏原");

      const userUtility = scoreUser(candidate, context, choice, budget, commute);
      const utilities = [userUtility];
      for (let i = 1; i < context.config.people; i += 1) utilities.push(scoreVirtualMember(candidate, i));
      const minUtility = Math.min(...utilities);
      const meanUtility = utilities.reduce((sum, value) => sum + value, 0) / utilities.length;
      const geoMean = Math.exp(utilities.reduce((sum, value) => sum + Math.log(Math.max(value, 0.01)), 0) / utilities.length);
      const maxRegret = 1 - minUtility;
      const uncertainty = clamp((candidate.source.mode === "demo" ? 0.08 : 0) + unknownFacts.length * 0.055, 0, 0.32);
      const raw = 0.4 * minUtility + 0.3 * geoMean + 0.2 * meanUtility + 0.1 * (1 - maxRegret) - 0.1 * uncertainty;
      const groupFit = Math.round(clamp(raw, 0, 1) * 100);
      const evidence = buildEvidence(candidate, choice, budget, commute);

      return [{
        ...candidate,
        groupFit,
        minUtility: Math.round(minUtility * 100),
        meanUtility: Math.round(meanUtility * 100),
        geoMean: Math.round(geoMean * 100),
        uncertainty: Math.round(uncertainty * 100),
        userUtility: Math.round(userUtility * 100),
        evidence,
        unknownFacts,
        explanation: `${evidence.slice(0, 2).join("；")}。Group Fit 由你与 ${Math.max(0, context.config.people - 1)} 位演示成员的效用聚合计算。`,
      }];
    })
    .sort((a, b) => b.groupFit - a.groupFit || b.userUtility - a.userUtility);
}

function scoreUser(candidate: Candidate, context: RankContext, choice: Choice | undefined, budget: number | null, commute: number | null): number {
  let score = choice === "like" ? 0.94 : choice === "okay" ? 0.62 : 0.5;
  const adjustments: number[] = [];
  if (budget !== null && candidate.priceValue !== null) adjustments.push(clamp(1 - candidate.priceValue / Math.max(budget, 1) * 0.5, 0.35, 1));
  if (commute !== null && candidate.estimatedTravelMinutes !== null) adjustments.push(clamp(1 - candidate.estimatedTravelMinutes / Math.max(commute, 1) * 0.35, 0.4, 1));
  if (context.setting === "室内优先" && candidate.features.indoor !== null) adjustments.push(candidate.features.indoor ? 0.95 : 0.45);
  if (context.setting === "户外优先" && candidate.features.indoor !== null) adjustments.push(candidate.features.indoor ? 0.45 : 0.95);
  if (context.setting === "不吃辣" && candidate.features.nonSpicyAvailable !== null) adjustments.push(candidate.features.nonSpicyAvailable ? 0.95 : 0.1);
  for (const preference of context.extraction?.softPreferences ?? []) adjustments.push(featureMatch(candidate, preference.feature));
  if (candidate.rating !== null) adjustments.push(clamp(candidate.rating / 5, 0.5, 1));
  if (adjustments.length) score = 0.58 * score + 0.42 * (adjustments.reduce((a, b) => a + b, 0) / adjustments.length);
  return clamp(score, 0.05, 0.99);
}

function scoreVirtualMember(candidate: Candidate, memberIndex: number): number {
  const hashed = stableHash(`${candidate.id}:${memberIndex}`) % 31;
  const base = 0.55 + hashed / 100;
  const ratingBoost = candidate.rating === null ? 0 : (candidate.rating - 3.5) * 0.05;
  return clamp(base + ratingBoost, 0.45, 0.94);
}

function featureMatch(candidate: Candidate, feature: SoftPreferenceFeature): number {
  if (feature === "quiet") return tri(candidate.features.quiet);
  if (feature === "conversation") return tri(candidate.features.conversationFriendly);
  if (feature === "indoor") return tri(candidate.features.indoor);
  if (feature === "outdoor") return candidate.features.indoor === null ? 0.55 : candidate.features.indoor ? 0.3 : 0.95;
  if (feature === "queue_time") return candidate.features.queueRisk === "low" ? 0.95 : candidate.features.queueRisk === "medium" ? 0.6 : candidate.features.queueRisk === "high" ? 0.25 : 0.55;
  if (feature === "price") return candidate.priceValue === null ? 0.55 : clamp(1 - candidate.priceValue / 350, 0.25, 0.95);
  return 0.55;
}

function buildEvidence(candidate: Candidate, choice: Choice | undefined, budget: number | null, commute: number | null): string[] {
  const evidence: string[] = [];
  if (choice === "like") evidence.push("你在滑卡中标记了喜欢");
  else if (choice === "okay") evidence.push("你标记为可以接受");
  if (budget !== null && candidate.priceValue !== null) evidence.push(`¥${candidate.priceValue}/人未超过 ¥${budget} 上限`);
  if (commute !== null && candidate.estimatedTravelMinutes !== null) evidence.push(`通勤估算 ${candidate.estimatedTravelMinutes} 分钟，未超过 ${commute} 分钟`);
  if (candidate.rating !== null) evidence.push(`地点数据评分 ${candidate.rating.toFixed(1)}`);
  if (evidence.length === 0) evidence.push("基于当前滑卡与偏好信号排序");
  return evidence;
}

function formatDuration(minutes: number): string {
  if (minutes % 60 === 0) return `${minutes / 60} 小时`;
  return `${Math.floor(minutes / 60)}.5 小时`;
}

function parseLimit(label: string): number | null {
  if (/不限/.test(label)) return null;
  const match = label.match(/\d+/);
  return match ? Number(match[0]) : null;
}

function mergeNumericLimit(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.min(a, b);
}

function constraintNumber(extraction: PreferenceExtraction | null, type: HardConstraintType): number | null {
  const value = extraction?.hardConstraints.find((item) => item.type === type)?.value;
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function constraintTime(extraction: PreferenceExtraction | null, type: HardConstraintType): number | null {
  const value = extraction?.hardConstraints.find((item) => item.type === type)?.value;
  return value ? toMinutes(value) : null;
}

function hasConstraint(extraction: PreferenceExtraction | null, type: HardConstraintType): boolean {
  return Boolean(extraction?.hardConstraints.some((item) => item.type === type));
}

function toMinutes(time: string): number {
  const [hour, minute] = time.split(":").map(Number);
  return Number.isFinite(hour) && Number.isFinite(minute) ? hour * 60 + minute : 0;
}

function tri(value: boolean | null): number {
  return value === null ? 0.55 : value ? 0.95 : 0.3;
}

function stableHash(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  return Math.abs(hash >>> 0);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function estimateTravelMinutes(city: CityName, location: { lng: number; lat: number } | null): number | null {
  if (!location) return null;
  const [centerLng, centerLat] = CITY_PROFILES[city].center;
  const distance = haversineKm(centerLat, centerLng, location.lat, location.lng);
  return Math.round(clamp(12 + distance * 3.2, 12, 75));
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLng = (lng2 - lng1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
