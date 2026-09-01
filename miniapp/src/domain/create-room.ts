import type { DecisionKind } from "../types/api.ts";

export const supportedCities = ["上海", "北京", "广州", "深圳", "杭州", "成都", "南京", "重庆", "苏州", "合肥"] as const;
export const diningTendencies = ["本帮菜", "日料", "火锅", "烤肉", "粤菜", "西餐", "东北菜", "川湘菜", "云贵菜", "江西菜", "东南亚菜", "素食", "Brunch", "小酒馆"] as const;
export const activityTendencies = ["头疗按摩", "攀岩", "电影", "陶艺泥塑", "KTV", "拼豆手作", "剧本杀", "麻将棋牌", "桌游", "密室逃脱", "保龄球", "羽毛球", "脱口秀", "展览", "景点"] as const;

export type CityName = (typeof supportedCities)[number];
export type TimePeriod = "morning" | "afternoon" | "evening";
export type DurationChoice = 120 | 180 | 240 | "240_plus" | null;
export type DiscoveryMode = "inspiration" | "ideas";
export type GeoPoint = { lng: number; lat: number };

export type CreateDraft = {
  kind: DecisionKind;
  city: CityName;
  origin: string;
  originLocation: GeoPoint | null;
  dateRange: { start: string; end: string };
  preferredPeriods: TimePeriod[];
  durationMinutes: DurationChoice;
  discoveryMode: DiscoveryMode;
  tendencies: string[];
  avoid: string;
  people: number;
};

export function toggleTendencySelection(selected: string[], tendency: string): { tendencies: string[]; message: string | null } {
  if (selected.includes(tendency)) return { tendencies: selected.filter((item) => item !== tendency), message: null };
  if (selected.length >= 6) return { tendencies: selected, message: "最多选择 6 个想法" };
  return { tendencies: [...selected, tendency], message: null };
}

export function initialCreateDraft(kind: DecisionKind, startDate = nextLocalDate()): CreateDraft {
  return {
    kind,
    city: "上海",
    origin: "",
    originLocation: null,
    dateRange: { start: startDate, end: startDate },
    preferredPeriods: ["evening"],
    durationMinutes: 180,
    discoveryMode: "inspiration",
    tendencies: [],
    avoid: "",
    people: 4,
  };
}

export function validateCreateDraft(draft: CreateDraft): { ok: true } | { ok: false; message: string } {
  if (!supportedCities.includes(draft.city)) return { ok: false, message: "请选择城市" };
  if (!draft.origin.trim()) return { ok: false, message: "请填写出发地" };
  if (!isDate(draft.dateRange.start) || !isDate(draft.dateRange.end) || draft.dateRange.end < draft.dateRange.start) {
    return { ok: false, message: "请选择有效日期范围" };
  }
  if (calendarDaysBetween(draft.dateRange.start, draft.dateRange.end) > 13) return { ok: false, message: "日期范围最多 14 天" };
  if (!draft.preferredPeriods.length || draft.preferredPeriods.some((period) => !["morning", "afternoon", "evening"].includes(period))) {
    return { ok: false, message: "请选择大概时段" };
  }
  if (![120, 180, 240, "240_plus", null].includes(draft.durationMinutes)) {
    return { ok: false, message: "请选择预计时长" };
  }
  if (draft.discoveryMode === "ideas" && draft.tendencies.length > 6) return { ok: false, message: "最多选择 6 个想法" };
  if (!Number.isInteger(draft.people) || draft.people < 2 || draft.people > 6) return { ok: false, message: "请选择 2–6 人" };
  return { ok: true };
}

function isDate(value: string) {
  const matched = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!matched) return false;
  const [year, month, day] = matched.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function calendarDaysBetween(start: string, end: string) {
  return (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000;
}

function nextLocalDate() {
  const date = new Date(Date.now() + 86_400_000);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
