export const PERIOD_WINDOWS = {
  morning: [8 * 60, 12 * 60],
  afternoon: [12 * 60, 18 * 60],
  evening: [18 * 60, 24 * 60],
} as const;

export type TimePeriod = keyof typeof PERIOD_WINDOWS;
export type DurationChoice = 120 | 180 | 240 | "240_plus" | null;
export type DateRange = { start: string; end: string };
export type AvailabilityInterval = { startAt: string; endAt: string };
export type ResolvedSchedule = { startAt: string; endAt: string; attendeeIds: string[] };
export type ScheduleConfig = { dateRange: DateRange; preferredPeriods: TimePeriod[]; durationMinutes: DurationChoice };
export type MemberAvailability = { memberId: string; intervals: AvailabilityInterval[] | null };
export type ScheduleResolution =
  | { status: "incomplete"; schedule: null; pendingMemberIds: string[] }
  | { status: "resolved"; schedule: ResolvedSchedule; suggestedDurationMinutes: number }
  | { status: "partial"; schedule: ResolvedSchedule | null; unavailableMemberIds: string[]; suggestedDurationMinutes: number | null };

const HALF_HOUR = 30 * 60_000;
const SHANGHAI_OFFSET = "+08:00";

function dateOnly(value: string) {
  return new Date(`${value}T00:00:00${SHANGHAI_OFFSET}`);
}

export function validateScheduleConfig(config: ScheduleConfig) {
  const start = dateOnly(config.dateRange.start).getTime();
  const end = dateOnly(config.dateRange.end).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) throw new Error("日期范围无效");
  if ((end - start) / 86_400_000 + 1 > 14) throw new Error("日期范围不能超过 14 天");
  if (!config.preferredPeriods.length || config.preferredPeriods.some((item) => !(item in PERIOD_WINDOWS))) throw new Error("至少选择一个有效时段");
  if (![120, 180, 240, "240_plus", null].includes(config.durationMinutes)) throw new Error("活动时长无效");
}

function parseInterval(interval: AvailabilityInterval, config: ScheduleConfig) {
  const start = new Date(interval.startAt).getTime();
  const end = new Date(interval.endAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw new Error("空闲时间区间无效");
  const localStart = new Date(start + 8 * 60 * 60_000);
  const localEnd = new Date(end + 8 * 60 * 60_000);
  if (localStart.getUTCMinutes() % 30 || localEnd.getUTCMinutes() % 30 || localStart.getUTCSeconds() || localEnd.getUTCSeconds()) throw new Error("空闲时间必须按 30 分钟选择");
  const first = dateOnly(config.dateRange.start).getTime();
  const last = dateOnly(config.dateRange.end).getTime() + 24 * 60 * 60_000;
  if (start < first || end > last) throw new Error("空闲时间必须位于房间日期范围内");
  return { start, end };
}

function formatAt(timestamp: number) {
  const local = new Date(timestamp + 8 * 60 * 60_000);
  return `${local.getUTCFullYear()}-${String(local.getUTCMonth() + 1).padStart(2, "0")}-${String(local.getUTCDate()).padStart(2, "0")}T${String(local.getUTCHours()).padStart(2, "0")}:${String(local.getUTCMinutes()).padStart(2, "0")}:00${SHANGHAI_OFFSET}`;
}

function periodMatch(timestamp: number, periods: TimePeriod[]) {
  const local = new Date(timestamp + 8 * 60 * 60_000);
  const minute = local.getUTCHours() * 60 + local.getUTCMinutes();
  return periods.some((period) => minute >= PERIOD_WINDOWS[period][0] && minute < PERIOD_WINDOWS[period][1]) ? 1 : 0;
}

export function resolveGroupSchedule(config: ScheduleConfig, members: MemberAvailability[]): ScheduleResolution {
  validateScheduleConfig(config);
  const pendingMemberIds = members.filter((member) => member.intervals === null).map((member) => member.memberId);
  if (pendingMemberIds.length) return { status: "incomplete", schedule: null, pendingMemberIds };

  const normalized = members.map((member) => {
    if ((member.intervals?.length ?? 0) > 64) throw new Error("每位成员最多提交 64 个空闲区间");
    const intervals = (member.intervals ?? []).map((interval) => parseInterval(interval, config)).sort((a, b) => a.start - b.start);
    for (let i = 1; i < intervals.length; i += 1) if (intervals[i].start < intervals[i - 1].end) throw new Error("空闲时间区间不能重叠");
    return { memberId: member.memberId, intervals };
  });
  const starts = [...new Set(normalized.flatMap((member) => member.intervals.flatMap((interval) => {
    const result: number[] = [];
    for (let cursor = interval.start; cursor < interval.end; cursor += HALF_HOUR) result.push(cursor);
    return result;
  })))];
  const minimum = config.durationMinutes === null ? HALF_HOUR : (config.durationMinutes === "240_plus" ? 240 : config.durationMinutes) * 60_000;
  const options = starts.map((start) => {
    const containing = normalized.filter((member) => member.intervals.some((interval) => interval.start <= start && interval.end >= start + minimum));
    const commonEnd = containing.length ? Math.min(...containing.map((member) => Math.max(...member.intervals.filter((interval) => interval.start <= start && interval.end >= start + minimum).map((interval) => interval.end)))) : start;
    const end = config.durationMinutes === "240_plus" || config.durationMinutes === null ? commonEnd : start + minimum;
    const attendeeIds = containing.map((member) => member.memberId).sort();
    const slack = containing.reduce((sum, member) => sum + Math.max(...member.intervals.filter((interval) => interval.start <= start && interval.end >= start + minimum).map((interval) => interval.end - end)), 0);
    return { start, end, attendeeIds, slack, preferred: periodMatch(start, config.preferredPeriods) };
  }).filter((option) => option.attendeeIds.length > 0 && option.end > option.start)
    .sort((a, b) => b.attendeeIds.length - a.attendeeIds.length || b.preferred - a.preferred || b.slack - a.slack || a.start - b.start);
  const best = options[0];
  if (!best) return { status: "partial", schedule: null, unavailableMemberIds: normalized.map((member) => member.memberId), suggestedDurationMinutes: null };
  const schedule = { startAt: formatAt(best.start), endAt: formatAt(best.end), attendeeIds: best.attendeeIds };
  const suggestedDurationMinutes = Math.round((best.end - best.start) / 60_000);
  if (best.attendeeIds.length === normalized.length) return { status: "resolved", schedule, suggestedDurationMinutes };
  return { status: "partial", schedule, unavailableMemberIds: normalized.map((member) => member.memberId).filter((id) => !best.attendeeIds.includes(id)), suggestedDurationMinutes };
}
