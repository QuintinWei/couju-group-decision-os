export type AvailabilityDraftRange = {
  date: string;
  start: string;
  end: string;
};

export type AvailabilityInterval = {
  startAt: string;
  endAt: string;
};

export type DateRange = { start: string; end: string };

export type ScheduleResolution =
  | { status: "incomplete"; schedule: null; pendingMemberIds: string[] }
  | { status: "resolved"; schedule: { startAt: string; endAt: string; attendeeIds: string[] }; suggestedDurationMinutes: number }
  | { status: "partial"; schedule: { startAt: string; endAt: string; attendeeIds: string[] } | null; unavailableMemberIds: string[]; suggestedDurationMinutes: number | null };

export type AvailabilityValidation = { ok: true } | { ok: false; message: string };

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export function validateAvailabilityDraft(draft: AvailabilityDraftRange[], dateRange: DateRange): AvailabilityValidation {
  if (draft.length === 0) return { ok: false, message: "请至少添加一段空闲时间" };

  for (const interval of draft) {
    if (!isCalendarDate(interval.date) || interval.date < dateRange.start || interval.date > dateRange.end) {
      return { ok: false, message: "空闲日期必须在房间日期范围内" };
    }
    if (!timePattern.test(interval.start) || !timePattern.test(interval.end)) {
      return { ok: false, message: "请选择有效的开始和结束时间" };
    }
    if (!isHalfHour(interval.start) || !isHalfHour(interval.end)) {
      return { ok: false, message: "时间的分钟请选择 00 或 30" };
    }
    if (toMinute(interval.start) >= toMinute(interval.end)) {
      return { ok: false, message: "结束时间必须晚于开始时间" };
    }
  }

  const sorted = draft
    .map((item) => ({ start: `${item.date}T${item.start}`, end: `${item.date}T${item.end}` }))
    .sort((left, right) => left.start.localeCompare(right.start));
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index].start < sorted[index - 1].end) return { ok: false, message: "空闲时间区间不能重叠" };
  }
  return { ok: true };
}

export function buildAvailabilityIntervals(draft: AvailabilityDraftRange[]): AvailabilityInterval[] {
  return draft.map((interval) => ({
    startAt: `${interval.date}T${interval.start}:00+08:00`,
    endAt: `${interval.date}T${interval.end}:00+08:00`,
  }));
}

export function enumerateDates(dateRange: DateRange) {
  if (!isCalendarDate(dateRange.start) || !isCalendarDate(dateRange.end) || dateRange.end < dateRange.start) return [];
  const result: string[] = [];
  const end = new Date(`${dateRange.end}T00:00:00Z`).getTime();
  for (let cursor = new Date(`${dateRange.start}T00:00:00Z`).getTime(); cursor <= end; cursor += 86_400_000) {
    result.push(new Date(cursor).toISOString().slice(0, 10));
  }
  return result;
}

function isHalfHour(value: string) {
  return value.endsWith(":00") || value.endsWith(":30");
}

function toMinute(value: string) {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

function isCalendarDate(value: string) {
  if (!datePattern.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
