import assert from "node:assert/strict";
import test from "node:test";
import { resolveGroupSchedule, validateScheduleConfig } from "../lib/scheduling.ts";

const config = {
  dateRange: { start: "2026-08-29", end: "2026-08-30" },
  preferredPeriods: ["afternoon"],
  durationMinutes: 180,
};

test("resolves the only all-member three-hour window", () => {
  const result = resolveGroupSchedule(config, [
    { memberId: "a", intervals: [{ startAt: "2026-08-29T13:00:00+08:00", endAt: "2026-08-29T18:00:00+08:00" }] },
    { memberId: "b", intervals: [{ startAt: "2026-08-29T14:00:00+08:00", endAt: "2026-08-29T17:00:00+08:00" }] },
  ]);
  assert.equal(result.status, "resolved");
  assert.deepEqual(result.schedule, {
    startAt: "2026-08-29T14:00:00+08:00",
    endAt: "2026-08-29T17:00:00+08:00",
    attendeeIds: ["a", "b"],
  });
});

test("returns a stable maximum-attendance window instead of fake consensus", () => {
  const result = resolveGroupSchedule({ ...config, durationMinutes: 120 }, [
    { memberId: "a", intervals: [{ startAt: "2026-08-29T09:00:00+08:00", endAt: "2026-08-29T12:00:00+08:00" }] },
    { memberId: "b", intervals: [{ startAt: "2026-08-29T09:30:00+08:00", endAt: "2026-08-29T12:00:00+08:00" }] },
    { memberId: "c", intervals: [{ startAt: "2026-08-29T18:00:00+08:00", endAt: "2026-08-29T22:00:00+08:00" }] },
  ]);
  assert.equal(result.status, "partial");
  assert.deepEqual(result.schedule.attendeeIds, ["a", "b"]);
  assert.deepEqual(result.unavailableMemberIds, ["c"]);
});

test("distinguishes an unsubmitted member from submitted no availability", () => {
  assert.equal(resolveGroupSchedule(config, [{ memberId: "a", intervals: null }]).status, "incomplete");
  assert.equal(resolveGroupSchedule(config, [{ memberId: "a", intervals: [] }]).status, "partial");
});

test("validates half-hour intervals inside a fourteen-day range", () => {
  assert.throws(() => validateScheduleConfig({ ...config, dateRange: { start: "2026-08-01", end: "2026-08-16" } }), /14/);
  assert.throws(() => resolveGroupSchedule(config, [{ memberId: "a", intervals: [{ startAt: "2026-08-29T13:10:00+08:00", endAt: "2026-08-29T16:10:00+08:00" }] }]), /30/);
});

test("four hours plus uses the complete common window and uncertain duration suggests it", () => {
  const members = [
    { memberId: "a", intervals: [{ startAt: "2026-08-29T12:00:00+08:00", endAt: "2026-08-29T18:30:00+08:00" }] },
    { memberId: "b", intervals: [{ startAt: "2026-08-29T13:00:00+08:00", endAt: "2026-08-29T18:00:00+08:00" }] },
  ];
  const long = resolveGroupSchedule({ ...config, durationMinutes: "240_plus" }, members);
  assert.equal(long.schedule.endAt, "2026-08-29T18:00:00+08:00");
  const uncertain = resolveGroupSchedule({ ...config, durationMinutes: null }, members);
  assert.equal(uncertain.suggestedDurationMinutes, 300);
});
