export type Stage = "home" | "create" | "join" | "room" | "setup" | "swipe" | "constraints" | "ranking" | "results" | "locked";
export type Choice = "no" | "okay" | "like";
export const PREFERENCE_FLOW = ["setup", "swipe", "constraints"] as const;

export function canRefreshCandidates(isCreator: boolean, stage: Stage, hasResult: boolean) {
  return isCreator && stage === "results" && hasResult;
}

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

export const DINING_INTERESTS = ["本帮菜", "日料", "火锅", "烤肉", "粤菜", "西餐", "东北菜", "川湘菜", "云贵菜", "江西菜", "东南亚菜", "素食", "Brunch", "小酒馆"] as const;
export const ACTIVITY_INTERESTS = ["头疗按摩", "攀岩", "电影", "陶艺泥塑", "KTV", "拼豆手作", "剧本杀", "麻将棋牌", "桌游", "密室逃脱", "保龄球", "羽毛球", "脱口秀", "展览", "景点"] as const;
export const DEFAULT_INTERESTS: Record<DecisionKind, string[]> = {
  dining: [...DINING_INTERESTS],
  activity: [...ACTIVITY_INTERESTS],
};

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
  segment?: "nomination" | "learned" | "explore";
  kind: DecisionKind;
  city: CityName;
  type: string;
  name: string;
  meta: string;
  matchedInterest?: string;
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

export type GroupMemberPreference = {
  id: string;
  name: string;
  origin: string;
  originLocation?: { lng: number; lat: number } | null;
  budgetLabel: string;
  commuteLabel: string;
  setting: string;
  note: string;
  extraction: PreferenceExtraction | null;
  choices: Record<string, Choice>;
  submittedAt: string | null;
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
  memberUtilities: Array<{ memberId: string; name: string; utility: number; travelMinutes: number | null }>;
  meanTravelMinutes: number | null;
  onParetoFrontier: boolean;
};

type DemoTemplate = Omit<Candidate, "city" | "district" | "address" | "source" | "location"> & { travel: number };

const activityTemplates: DemoTemplate[] = [
  demo("massage", "activity", "头疗按摩", "松下头疗放松馆", "头疗按摩 · 双人放松", "/candidates/activity-brunch.jpg", 168, 90, 24, { indoor: true, quiet: true, conversationFriendly: false, nonSpicyAvailable: null, queueRisk: "low" }),
  demo("climb", "activity", "攀岩", "岩时攀岩馆", "室内抱石 · 含基础教学", "/candidates/activity-climb.jpg", 198, 150, 32, { indoor: true, quiet: false, conversationFriendly: false, nonSpicyAvailable: null, queueRisk: "medium" }),
  demo("cinema", "activity", "电影", "光影电影空间", "多人观影 · 场次需确认", "/candidates/activity-museum.jpg", 78, 150, 22, { indoor: true, quiet: true, conversationFriendly: false, nonSpicyAvailable: null, queueRisk: "medium" }),
  demo("pottery", "activity", "陶艺泥塑", "泥作陶艺工坊", "拉坯体验 · 作品可烧制", "/candidates/activity-pottery.jpg", 158, 120, 26, { indoor: true, quiet: true, conversationFriendly: true, nonSpicyAvailable: null, queueRisk: "low" }),
  demo("ktv", "activity", "KTV", "声场量贩 KTV", "多人包厢 · 适合聚会", "/candidates/activity-boardgame.jpg", 128, 180, 30, { indoor: true, quiet: false, conversationFriendly: true, nonSpicyAvailable: null, queueRisk: "medium" }),
  demo("beads", "activity", "拼豆手作", "像素拼豆工作室", "材料任选 · 零基础友好", "/candidates/activity-pottery.jpg", 98, 120, 18, { indoor: true, quiet: true, conversationFriendly: true, nonSpicyAvailable: null, queueRisk: "low" }),
  demo("murder", "activity", "剧本杀", "谜盒沉浸剧场", "多人推理 · 主题需确认", "/candidates/activity-escape.jpg", 168, 240, 28, { indoor: true, quiet: true, conversationFriendly: true, nonSpicyAvailable: null, queueRisk: "low" }),
  demo("mahjong", "activity", "麻将棋牌", "碰面棋牌空间", "独立包间 · 自动麻将桌", "/candidates/activity-boardgame.jpg", 88, 180, 20, { indoor: true, quiet: false, conversationFriendly: true, nonSpicyAvailable: null, queueRisk: "low" }),
  demo("scenic", "activity", "景点", "城市文化漫游线", "展馆与街区 · 适合周末慢慢逛", "/candidates/activity-camp.jpg", 98, 180, 24, { indoor: null, quiet: true, conversationFriendly: true, nonSpicyAvailable: null, queueRisk: "low" }),
  demo("boardgame", "activity", "桌游", "桌游社交空间", "策略桌游 · 新手可教学", "/candidates/activity-boardgame.jpg", 108, 180, 25, { indoor: true, quiet: false, conversationFriendly: true, nonSpicyAvailable: null, queueRisk: "low" }),
  demo("escape", "activity", "密室逃脱", "边界密室体验馆", "沉浸主题 · 建议提前预约", "/candidates/activity-escape.jpg", 178, 150, 29, { indoor: true, quiet: false, conversationFriendly: true, nonSpicyAvailable: null, queueRisk: "medium" }),
  demo("bowling", "activity", "保龄球", "全垒打保龄球馆", "球道体验 · 适合小组互动", "/candidates/activity-climb.jpg", 118, 120, 27, { indoor: true, quiet: false, conversationFriendly: true, nonSpicyAvailable: null, queueRisk: "medium" }),
];

const diningTemplates: DemoTemplate[] = [
  demo("yunnan", "dining", "云贵菜", "山野云贵菜", "菌菇与汽锅鸡 · 可沟通不辣", "/candidates/food-yunnan.jpg", 148, 120, 28, { indoor: true, quiet: true, conversationFriendly: true, nonSpicyAvailable: true, queueRisk: "medium" }),
  demo("northeast", "dining", "东北菜", "北境灶台", "锅包肉与铁锅炖 · 适合多人分享", "/candidates/food-noodle.jpg", 138, 120, 30, { indoor: true, quiet: false, conversationFriendly: true, nonSpicyAvailable: true, queueRisk: "medium" }),
  demo("chuxiang", "dining", "川湘菜", "辣有度小馆", "小炒与家常菜 · 辣度可沟通", "/candidates/food-hotpot.jpg", 128, 120, 31, { indoor: true, quiet: false, conversationFriendly: true, nonSpicyAvailable: false, queueRisk: "medium" }),
  demo("jiangxi", "dining", "江西菜", "赣味小馆", "瓦罐汤与南昌拌粉 · 家常口味", "/candidates/food-noodle.jpg", 98, 90, 23, { indoor: true, quiet: false, conversationFriendly: true, nonSpicyAvailable: null, queueRisk: "low" }),
  demo("southeast-asian", "dining", "东南亚菜", "南洋食集", "海南鸡饭与泰式小食 · 适合分享", "/candidates/food-brunch.jpg", 158, 120, 29, { indoor: true, quiet: true, conversationFriendly: true, nonSpicyAvailable: true, queueRisk: "medium" }),
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
  const inventory = DEMO_VARIANTS.flatMap((variant, index) => templates.map((item) => index === 0 ? item : {
      ...item,
      id: `${item.id}-${index + 1}`,
      name: `${item.name} · ${variant}`,
      meta: `${item.meta} · ${variant}`,
      priceValue: item.priceValue + index * 6,
      priceLabel: `¥${item.priceValue + index * 6}/人`,
    }));
  return inventory.map((item, index) => {
    const location = demoLocation(city, `${kind}:${item.id}`, item.travel);
    return {
      ...item,
      id: `${city}-${item.id}`,
      city,
      district: profile.districts[index % profile.districts.length],
      address: `${profile.districts[index % profile.districts.length]} · 演示地址不用于到店`,
      location,
      estimatedTravelMinutes: estimateTravelMinutes(city, location),
      source: {
        mode: "demo",
        label: "凑局演示候选库",
        fetchedAt: "2026-08-21T00:00:00.000Z",
      },
    };
  });
}

const DEMO_VARIANTS = ["本店", "静安店", "徐汇店", "长宁店", "黄浦店", "浦东店", "滨江店", "城市店", "艺文店", "夜场店", "周末店", "精选店"];

function demoLocation(city: CityName, seed: string, travelMinutes: number) {
  const [centerLng, centerLat] = CITY_PROFILES[city].center;
  const hash = hashString(`${city}:${seed}`);
  const angle = (hash % 3600) / 3600 * Math.PI * 2;
  const distanceKm = Math.max(0.8, (travelMinutes - 12) / 3.2);
  const latOffset = distanceKm * Math.cos(angle) / 111;
  const lngOffset = distanceKm * Math.sin(angle) / (111 * Math.cos(centerLat * Math.PI / 180));
  return { lng: centerLng + lngOffset, lat: centerLat + latOffset };
}

function hashString(value: string) {
  let hash = 2166136261;
  for (const char of value) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  return hash;
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
  return rankGroupCandidates(candidates, [{
    id: "current-user",
    name: "你",
    origin: "",
    budgetLabel: context.budgetLabel,
    commuteLabel: context.commuteLabel,
    setting: context.setting,
    note: "",
    extraction: context.extraction,
    choices: context.choices,
    submittedAt: new Date().toISOString(),
  }], context.config, context.excludedIds, context.vetoReason);
}

export function rankGroupCandidates(
  candidates: Candidate[],
  members: GroupMemberPreference[],
  config: RoomConfig,
  excludedIds: string[] = [],
  vetoReason = "",
): RankedCandidate[] {
  const readyMembers = members.filter((member) => member.submittedAt);
  if (readyMembers.length === 0) return [];
  const excluded = new Set(excludedIds);
  const scored = candidates
    .flatMap((candidate) => {
      if (excluded.has(candidate.id)) return [];
      const memberContexts = readyMembers.map((member) => {
        const budget = mergeNumericLimit(parseLimit(member.budgetLabel), constraintNumber(member.extraction, "max_budget"));
        let commute = parseCommuteLimit(member.commuteLabel);
        if (vetoReason === "还是太远" && commute !== null) commute = Math.max(10, commute - 10);
        const memberStart = Math.max(toMinutes(config.startTime), constraintTime(member.extraction, "arrival_after") ?? 0);
        const memberEnd = Math.min(toMinutes(config.endTime), constraintTime(member.extraction, "leave_before") ?? 24 * 60);
        const travelMinutes = estimateTravelBetween(member.originLocation ?? null, candidate.location) ?? candidate.estimatedTravelMinutes;
        return { member, budget, commute, travelMinutes, availableMinutes: Math.max(0, memberEnd - memberStart), noSpicy: member.setting === "不吃辣" || hasConstraint(member.extraction, "no_spicy") };
      });
      if (memberContexts.some(({ member, budget, commute, travelMinutes, availableMinutes, noSpicy }) =>
        member.choices[candidate.id] === "no" ||
        (budget !== null && candidate.priceValue !== null && candidate.priceValue > budget) ||
        (commute !== null && travelMinutes !== null && travelMinutes > commute) ||
        candidate.durationMinutes > availableMinutes ||
        (noSpicy && candidate.features.nonSpicyAvailable === false)
      )) return [];

      const unknownFacts: string[] = [];
      if (memberContexts.some(({ budget }) => budget !== null) && candidate.priceValue === null) unknownFacts.push("人均价格");
      if (memberContexts.some(({ commute }) => commute !== null) && candidate.estimatedTravelMinutes === null) unknownFacts.push("通勤时间");
      if (memberContexts.some(({ noSpicy }) => noSpicy) && candidate.features.nonSpicyAvailable === null) unknownFacts.push("不辣选项");
      if (candidate.source.mode === "live" && !candidate.openToday) unknownFacts.push("营业时间");
      if (memberContexts.some(({ member }) => hasConstraint(member.extraction, "allergy"))) unknownFacts.push("过敏原");

      const memberUtilities = memberContexts.map(({ member, budget, commute, travelMinutes }) => {
        const context: RankContext = { config, choices: member.choices, budgetLabel: member.budgetLabel, commuteLabel: member.commuteLabel, setting: member.setting, extraction: member.extraction };
        return { memberId: member.id, name: member.name, travelMinutes, utility: scoreUser(candidate, context, member.choices[candidate.id], budget, commute, travelMinutes) };
      });
      const utilities = memberUtilities.map((item) => item.utility);
      const minUtility = Math.min(...utilities);
      const meanUtility = utilities.reduce((sum, value) => sum + value, 0) / utilities.length;
      const geoMean = Math.exp(utilities.reduce((sum, value) => sum + Math.log(Math.max(value, 0.01)), 0) / utilities.length);
      const uncertainty = clamp((candidate.source.mode === "demo" ? 0.08 : 0) + unknownFacts.length * 0.055, 0, 0.32);
      const meetsFloor = minUtility >= 0.6;
      const raw = (meetsFloor ? 0.35 * minUtility + 0.55 * geoMean + 0.1 * meanUtility : 0.65 * minUtility + 0.25 * geoMean + 0.1 * meanUtility) - 0.08 * uncertainty;
      const groupFit = Math.round(clamp(raw, 0, 1) * 100);
      const likedCount = memberContexts.filter(({ member }) => member.choices[candidate.id] === "like").length;
      const evidence = [`${likedCount}/${readyMembers.length} 位成员明确喜欢`, `最低成员满意度 ${Math.round(minUtility * 100)}`, `Nash 群体效用 ${Math.round(geoMean * 100)}`];

      return [{
        ...candidate,
        groupFit,
        minUtility: Math.round(minUtility * 100),
        meanUtility: Math.round(meanUtility * 100),
        geoMean: Math.round(geoMean * 100),
        uncertainty: Math.round(uncertainty * 100),
        userUtility: Math.round(meanUtility * 100),
        evidence,
        unknownFacts,
        explanation: `${evidence.join("；")}。先排除任何成员明确拒绝或违反底线的地点，再用最低满意度与 Nash 几何均值寻找真实交集。`,
        memberUtilities: memberUtilities.map((item) => ({ ...item, utility: Math.round(item.utility * 100) })),
        meanTravelMinutes: averageKnown(memberUtilities.map((item) => item.travelMinutes)),
        onParetoFrontier: false,
      }];
    });
  const withFrontier = scored.map((candidate) => ({
    ...candidate,
    onParetoFrontier: !scored.some((other) => other.id !== candidate.id && dominates(other.memberUtilities, candidate.memberUtilities)),
  }));
  const floorExists = withFrontier.some((candidate) => candidate.minUtility >= 60);
  return withFrontier.sort((a, b) => {
    if (floorExists && (a.minUtility >= 60) !== (b.minUtility >= 60)) return a.minUtility >= 60 ? -1 : 1;
    if (a.onParetoFrontier !== b.onParetoFrontier) return a.onParetoFrontier ? -1 : 1;
    return b.groupFit - a.groupFit || b.minUtility - a.minUtility || b.meanUtility - a.meanUtility;
  });
}

function scoreUser(candidate: Candidate, context: RankContext, choice: Choice | undefined, budget: number | null, commute: number | null, travelOverride?: number | null): number {
  let score = choice === "like" ? 0.94 : choice === "okay" ? 0.62 : 0.5;
  const adjustments: number[] = [];
  if (budget !== null && candidate.priceValue !== null) adjustments.push(clamp(1 - candidate.priceValue / Math.max(budget, 1) * 0.5, 0.35, 1));
  const travel = travelOverride === undefined ? candidate.estimatedTravelMinutes : travelOverride;
  if (commute !== null && travel !== null) adjustments.push(clamp(1 - travel / Math.max(commute, 1) * 0.35, 0.4, 1));
  if (context.setting === "室内优先" && candidate.features.indoor !== null) adjustments.push(candidate.features.indoor ? 0.95 : 0.45);
  if (context.setting === "户外优先" && candidate.features.indoor !== null) adjustments.push(candidate.features.indoor ? 0.45 : 0.95);
  if (context.setting === "安静聊天") {
    if (candidate.features.quiet !== null) adjustments.push(candidate.features.quiet ? 0.98 : 0.42);
    if (candidate.features.conversationFriendly !== null) adjustments.push(candidate.features.conversationFriendly ? 0.96 : 0.5);
  }
  if (context.setting === "热闹聚会" && candidate.features.quiet !== null) adjustments.push(candidate.features.quiet ? 0.58 : 0.94);
  if (context.setting === "不吃辣" && candidate.features.nonSpicyAvailable !== null) adjustments.push(candidate.features.nonSpicyAvailable ? 0.95 : 0.1);
  for (const preference of context.extraction?.softPreferences ?? []) adjustments.push(featureMatch(candidate, preference.feature));
  if (candidate.rating !== null) adjustments.push(clamp(candidate.rating / 5, 0.5, 1));
  if (adjustments.length) score = 0.58 * score + 0.42 * (adjustments.reduce((a, b) => a + b, 0) / adjustments.length);
  return clamp(score, 0.05, 0.99);
}

function dominates(a: Array<{ memberId: string; utility: number }>, b: Array<{ memberId: string; utility: number }>) {
  if (a.length !== b.length) return false;
  let strictlyBetter = false;
  for (const item of a) {
    const other = b.find((candidate) => candidate.memberId === item.memberId);
    if (!other || item.utility < other.utility) return false;
    if (item.utility > other.utility) strictlyBetter = true;
  }
  return strictlyBetter;
}

function averageKnown(values: Array<number | null>) {
  const known = values.filter((value): value is number => value !== null);
  return known.length ? Math.round(known.reduce((sum, value) => sum + value, 0) / known.length) : null;
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

function formatDuration(minutes: number): string {
  if (minutes % 60 === 0) return `${minutes / 60} 小时`;
  return `${Math.floor(minutes / 60)}.5 小时`;
}

function parseLimit(label: string): number | null {
  if (/不限/.test(label)) return null;
  const match = label.match(/\d+/);
  return match ? Number(match[0]) : null;
}

export function parseCommuteLimit(label: string): number | null {
  if (/不限/.test(label)) return null;
  const match = label.match(/(\d+(?:\.\d+)?)\s*(小时|分钟)?/);
  if (!match) return null;
  const value = Number(match[1]);
  return match[2] === "小时" ? Math.round(value * 60) : value;
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function estimateTravelMinutes(city: CityName, location: { lng: number; lat: number } | null): number | null {
  if (!location) return null;
  const [centerLng, centerLat] = CITY_PROFILES[city].center;
  const distance = haversineKm(centerLat, centerLng, location.lat, location.lng);
  return Math.round(clamp(12 + distance * 3.2, 12, 75));
}

export function estimateTravelBetween(origin: { lng: number; lat: number } | null, destination: { lng: number; lat: number } | null): number | null {
  if (!origin || !destination) return null;
  const distance = haversineKm(origin.lat, origin.lng, destination.lat, destination.lng);
  return Math.round(clamp(10 + distance * 3.4, 8, 90));
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLng = (lng2 - lng1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
