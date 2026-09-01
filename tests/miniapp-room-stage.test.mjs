import assert from "node:assert/strict";
import test from "node:test";

import { buildAvailabilityIntervals, enumerateDates, validateAvailabilityDraft } from "../miniapp/src/domain/availability.ts";
import { constraintErrorState } from "../miniapp/src/domain/constraints.ts";
import { createVisibleRoomPoller } from "../miniapp/src/domain/room-polling.ts";
import { memberSetupProgress, nextRequiredPage } from "../miniapp/src/domain/room-stage.ts";
import { createMembersService, resolveRoomMembership } from "../miniapp/src/services/members-core.ts";

function room(overrides = {}) {
  return {
    code: "ABC123",
    config: {
      kind: "dining",
      city: "上海",
      people: 2,
      dateRange: { start: "2026-09-01", end: "2026-09-02" },
      preferredPeriods: ["evening"],
      durationMinutes: 120,
      resolvedSchedule: null,
      date: "2026-09-01",
      startTime: "",
      endTime: "",
    },
    candidates: [],
    meta: { mode: "demo", label: "测试", fetchedAt: "2026-09-01T00:00:00.000Z", groupIntersection: false },
    currentRound: 1,
    roundHistory: [],
    members: [],
    nominationCount: 0,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

function member(id, overrides = {}) {
  return {
    id,
    name: id,
    origin: "静安寺",
    originLocation: { lng: 121.45, lat: 31.23 },
    budgetLabel: "不限",
    commuteLabel: "不限",
    constraintsReady: false,
    setting: "都可以",
    note: "",
    extraction: null,
    choices: {},
    submittedAt: null,
    availability: null,
    refreshRequestRound: null,
    privateCandidates: [],
    nominatedCandidate: null,
    ...overrides,
  };
}

test("a member completes availability before constraints even while seats are still open", () => {
  const pending = room({ members: [member("a")] });
  assert.equal(nextRequiredPage(pending, "a"), "availability");

  pending.members[0].availability = [{ startAt: "2026-09-01T18:00:00+08:00", endAt: "2026-09-01T21:00:00+08:00" }];
  assert.equal(nextRequiredPage(pending, "a"), "constraints");
});

test("shared cards stay locked until target members, availability, constraints and the built intersection are all ready", () => {
  const ready = [
    member("a", { availability: [{ startAt: "2026-09-01T18:00:00+08:00", endAt: "2026-09-01T21:00:00+08:00" }], constraintsReady: true }),
    member("b", { availabilitySubmitted: true, constraintsReady: true }),
  ];
  const resolvedConfig = { ...room().config, resolvedSchedule: { startAt: "2026-09-01T18:00:00+08:00", endAt: "2026-09-01T20:00:00+08:00", attendeeIds: ["a", "b"] } };
  assert.equal(nextRequiredPage(room({ members: ready.slice(0, 1) }), "a"), "room");
  assert.equal(nextRequiredPage(room({ members: ready }), "a"), "availability");
  assert.equal(nextRequiredPage(room({ members: ready, config: resolvedConfig }), "a"), "constraints");
  assert.equal(nextRequiredPage(room({ members: ready, meta: { mode: "live", label: "交集", fetchedAt: "2026-09-01T00:00:00.000Z", groupIntersection: true } }), "a"), "availability");
  assert.equal(nextRequiredPage(room({
    members: ready,
    config: resolvedConfig,
    meta: { mode: "live", label: "交集", fetchedAt: "2026-09-01T00:00:00.000Z", groupIntersection: true },
  }), "a"), "swipe");
});

test("the room has one next page while waiting for peers and after everyone submits cards", () => {
  const submitted = [
    member("a", { availability: [], constraintsReady: true, submittedAt: "2026-09-01T10:00:00.000Z" }),
    member("b", { availabilitySubmitted: true, constraintsReady: true }),
  ];
  assert.equal(nextRequiredPage(room({ members: submitted, meta: { groupIntersection: true } }), "a"), "room");
  submitted[1].submittedAt = "2026-09-01T10:01:00.000Z";
  assert.equal(nextRequiredPage(room({ members: submitted, meta: { groupIntersection: true } }), "a"), "result");
});

test("member progress reads private availability for self and the redacted availability flag for peers", () => {
  const progress = memberSetupProgress(room({ members: [
    member("a", { availability: [], constraintsReady: true }),
    member("b", { availabilitySubmitted: true, constraintsReady: false }),
  ] }), "a");
  assert.deepEqual(progress, [
    { id: "a", name: "a", isSelf: true, availabilityReady: true, constraintsReady: true },
    { id: "b", name: "b", isSelf: false, availabilityReady: true, constraintsReady: false },
  ]);
});

test("availability range selectors produce the server interval DTO without a time grid", () => {
  const draft = [
    { date: "2026-09-01", start: "18:00", end: "20:30" },
    { date: "2026-09-01", start: "20:30", end: "22:00" },
    { date: "2026-09-02", start: "10:00", end: "12:00" },
  ];
  assert.deepEqual(validateAvailabilityDraft(draft, { start: "2026-09-01", end: "2026-09-02" }), { ok: true });
  assert.deepEqual(buildAvailabilityIntervals(draft), [
    { startAt: "2026-09-01T18:00:00+08:00", endAt: "2026-09-01T20:30:00+08:00" },
    { startAt: "2026-09-01T20:30:00+08:00", endAt: "2026-09-01T22:00:00+08:00" },
    { startAt: "2026-09-02T10:00:00+08:00", endAt: "2026-09-02T12:00:00+08:00" },
  ]);
});

test("the availability editor enumerates every room date without timezone drift", () => {
  assert.deepEqual(enumerateDates({ start: "2026-09-01", end: "2026-09-03" }), ["2026-09-01", "2026-09-02", "2026-09-03"]);
});

test("availability validation rejects reversed, overlapping, off-range and non-server-aligned ranges", () => {
  const dateRange = { start: "2026-09-01", end: "2026-09-02" };
  assert.match(validateAvailabilityDraft([{ date: "2026-09-01", start: "20:00", end: "19:00" }], dateRange).message, /晚于/);
  assert.match(validateAvailabilityDraft([
    { date: "2026-09-01", start: "18:00", end: "20:00" },
    { date: "2026-09-01", start: "19:30", end: "21:00" },
  ], dateRange).message, /重叠/);
  assert.match(validateAvailabilityDraft([{ date: "2026-09-03", start: "18:00", end: "20:00" }], dateRange).message, /日期范围/);
  assert.match(validateAvailabilityDraft([{ date: "2026-09-31", start: "18:00", end: "20:00" }], { start: "2026-09-01", end: "2026-10-02" }).message, /日期范围/);
  assert.match(validateAvailabilityDraft([{ date: "2026-09-01", start: "18:15", end: "20:00" }], dateRange).message, /00 或 30/);
});

test("visible room polling uses one four-second timer and stops on hide or unload", async () => {
  const intervals = [];
  const cleared = [];
  let refreshes = 0;
  const poller = createVisibleRoomPoller({
    refresh: async () => { refreshes += 1; },
    setInterval: (callback, milliseconds) => { intervals.push({ callback, milliseconds }); return intervals.length; },
    clearInterval: (id) => { cleared.push(id); },
  });

  poller.start();
  poller.start();
  await Promise.resolve();
  assert.equal(refreshes, 1);
  assert.deepEqual(intervals.map((item) => item.milliseconds), [4_000]);
  await intervals[0].callback();
  assert.equal(refreshes, 2);
  poller.stop();
  assert.deepEqual(cleared, [1]);
  poller.stop();
  assert.deepEqual(cleared, [1]);
});

test("members service restores linked membership and uses the deployed room and setup payloads", async () => {
  const calls = [];
  const saved = [];
  const membership = { roomCode: "ABC123", memberId: "member-a", memberToken: "secret-a" };
  const request = async (path, options = {}) => {
    calls.push({ path, options });
    if (path === "/api/members?roomCode=ABC123") return { identity: { memberId: "member-a", memberToken: "secret-a" } };
    if (path.startsWith("/api/rooms?")) return { room: room() };
    return { ok: true, ready: false };
  };
  const service = createMembersService({ request, saveMembership: (value) => saved.push(value) });

  assert.deepEqual(await service.restoreMembership("abc123"), membership);
  await service.getParticipantRoom(membership);
  await service.submitAvailability(membership, 1, [{ startAt: "2026-09-01T18:00:00+08:00", endAt: "2026-09-01T20:00:00+08:00" }]);
  await service.submitConstraints(membership, { budgetLabel: "≤ ¥150", commuteLabel: "≤ 60 分钟", setting: "安静聊天" });

  assert.deepEqual(saved, [membership]);
  assert.deepEqual(calls, [
    { path: "/api/members?roomCode=ABC123", options: {} },
    { path: "/api/rooms?code=ABC123&memberId=member-a&token=secret-a", options: {} },
    { path: "/api/availability", options: { method: "POST", membership, data: { expectedRound: 1, intervals: [{ startAt: "2026-09-01T18:00:00+08:00", endAt: "2026-09-01T20:00:00+08:00" }] } } },
    { path: "/api/members", options: { method: "PATCH", membership, data: { action: "constraints", budgetLabel: "≤ ¥150", commuteLabel: "≤ 60 分钟", setting: "安静聊天" } } },
  ]);
});

test("each room refresh re-reads storage so a cleared stale token restores linked membership", async () => {
  let stored = { roomCode: "ABC123", memberId: "old-member", memberToken: "old-token" };
  let restores = 0;
  const dependencies = {
    loadMembership: () => stored,
    restoreMembership: async () => { restores += 1; return { roomCode: "ABC123", memberId: "member-a", memberToken: "fresh-token" }; },
  };
  assert.deepEqual(await resolveRoomMembership("ABC123", dependencies), stored);
  stored = null;
  assert.deepEqual(await resolveRoomMembership("ABC123", dependencies), { roomCode: "ABC123", memberId: "member-a", memberToken: "fresh-token" });
  assert.equal(restores, 1);
});

test("a 409 candidate shortage preserves the server message and exposes commute editing", () => {
  assert.deepEqual(constraintErrorState({ status: 409, message: "当前通勤上限的共同可达地点不足 12 个" }), {
    message: "当前通勤上限的共同可达地点不足 12 个",
    canEditCommute: true,
  });
  assert.deepEqual(constraintErrorState({ status: 409, message: "共享卡池生成状态已变化，请刷新房间" }), {
    message: "共享卡池生成状态已变化，请刷新房间",
    canEditCommute: false,
  });
  assert.deepEqual(constraintErrorState(new Error("网络失败")), { message: "网络失败", canEditCommute: false });
});
