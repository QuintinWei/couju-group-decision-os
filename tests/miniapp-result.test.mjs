import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  canOpenPrivateDiscovery,
  deterministicRoundInsight,
  diagnoseParticipantConflict,
  isCompletedParticipantRound,
  participantRankings,
  pendingRecoveryMessage,
  resultAction,
  roomShareCard,
  resultWaitMessage,
  suggestParticipantCommuteRelaxation,
  togglePrivateNomination,
} from "../miniapp/src/domain/result-action.ts";
import { createMembersService } from "../miniapp/src/services/members-core.ts";
import { createRoundsService } from "../miniapp/src/services/rounds-core.ts";

function candidate(index, overrides = {}) {
  return {
    id: `candidate-${index}`,
    kind: "activity",
    city: "上海",
    type: index === 1 ? "陶艺泥塑" : "展览",
    name: index === 1 ? "第一选择" : `候选 ${index}`,
    meta: "测试候选",
    image: "https://example.com/candidate.jpg",
    priceValue: 100,
    priceLabel: "¥100/人",
    durationMinutes: 120,
    durationLabel: "2 小时",
    address: "上海市测试路",
    district: "静安区",
    location: null,
    estimatedTravelMinutes: 20,
    rating: null,
    openToday: null,
    source: { mode: "demo", label: "测试候选库", fetchedAt: "2026-09-01T00:00:00.000Z" },
    features: { indoor: true, quiet: true, conversationFriendly: true, nonSpicyAvailable: true, queueRisk: "low" },
    ...overrides,
  };
}

const candidates = Array.from({ length: 12 }, (_, index) => candidate(index + 1));

function member(id, name, choices, overrides = {}) {
  return {
    id,
    name,
    origin: "静安寺",
    originLocation: null,
    budgetLabel: "不限",
    commuteLabel: "不限",
    constraintsReady: true,
    setting: "都可以",
    note: "",
    extraction: null,
    choices,
    submittedAt: "2026-09-01T10:00:00.000Z",
    availability: [],
    refreshRequestRound: null,
    privateDiscoveryCompleted: false,
    privateCandidates: [],
    nominatedCandidate: null,
    ...overrides,
  };
}

function room(memberOverrides = [], overrides = {}) {
  const liked = Object.fromEntries(candidates.map((item) => [item.id, item.id === "candidate-1" ? "like" : "okay"]));
  const members = [
    member("creator", "小安", liked, memberOverrides[0]),
    member("member-b", "小北", liked, memberOverrides[1]),
  ];
  return {
    code: "ABC123",
    config: {
      kind: "activity",
      city: "上海",
      people: 2,
      dateRange: { start: "2026-09-05", end: "2026-09-05" },
      preferredPeriods: ["evening"],
      durationMinutes: 120,
      resolvedSchedule: { startAt: "2026-09-05T18:00:00+08:00", endAt: "2026-09-05T21:00:00+08:00", attendeeIds: ["creator", "member-b"] },
      date: "2026-09-05",
      startTime: "18:00",
      endTime: "21:00",
    },
    candidates,
    meta: { mode: "demo", label: "测试候选库", fetchedAt: "2026-09-01T00:00:00.000Z", groupIntersection: true },
    currentRound: 1,
    roundHistory: [],
    members,
    nominationCount: 0,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T10:00:00.000Z",
    ...overrides,
  };
}

test("the participant DTO produces one FairMix recommendation with real member scores", () => {
  const ranked = participantRankings(room());
  assert.equal(ranked[0].name, "第一选择");
  assert.equal(ranked[0].groupFit, 91);
  assert.deepEqual(ranked[0].memberUtilities.map(({ name, utility }) => ({ name, utility })), [
    { name: "小安", utility: 94 },
    { name: "小北", utility: 94 },
  ]);
  assert.equal(resultAction(room(), "creator"), "result");
});

test("result action derives private discovery and creator advance only from public participant fields", () => {
  const allNo = Object.fromEntries(candidates.map((item) => [item.id, "no"]));
  const conflicted = room([
    { choices: allNo },
    { choices: Object.fromEntries(candidates.map((item) => [item.id, "okay"])) },
  ], { canAdvance: true, canPrivateDiscover: ["not-a-member"] });

  assert.equal(resultAction(conflicted, "creator"), "private-discovery");
  assert.equal(resultAction(conflicted, "member-b"), "private-discovery");

  conflicted.members[0].refreshRequestRound = 1;
  conflicted.members[1].refreshRequestRound = 1;
  conflicted.members[0].privateCandidates = candidates.slice(0, 3);
  conflicted.members[1].privateCandidates = candidates.slice(0, 3);
  assert.equal(resultAction(conflicted, "creator"), "private-discovery");
  conflicted.members[0].privateDiscoveryCompleted = true;
  conflicted.members[1].privateDiscoveryCompleted = true;
  assert.equal(resultAction(conflicted, "creator"), "advance");
  assert.equal(resultAction(conflicted, "member-b"), "wait");

  conflicted.members[1].privateDiscoveryCompleted = false;
  assert.equal(resultAction(conflicted, "creator"), "wait");
  assert.equal(pendingRecoveryMessage(conflicted), "等待小北完成本轮恢复操作");
  assert.doesNotMatch(pendingRecoveryMessage(conflicted), /候选|卡片|提名|跳过/);
});

test("partial private discovery remains retryable after the refresh marker was saved", () => {
  const allNo = Object.fromEntries(candidates.map((item) => [item.id, "no"]));
  const partial = room([
    { choices: allNo, refreshRequestRound: 1, privateCandidates: [] },
    { choices: Object.fromEntries(candidates.map((item) => [item.id, "okay"])), refreshRequestRound: 1 },
  ]);
  assert.equal(canOpenPrivateDiscovery(partial, "creator"), true);
  assert.equal(resultAction(partial, "creator"), "private-discovery");
  partial.members[0].privateCandidates = candidates.slice(0, 3);
  assert.equal(resultAction(partial, "creator"), "private-discovery");
  partial.members[0].privateDiscoveryCompleted = true;
  partial.members[1].privateCandidates = candidates.slice(0, 3);
  partial.members[1].privateDiscoveryCompleted = true;
  assert.equal(resultAction(partial, "creator"), "advance");
});

test("an individually all-rejected member can open server-authorized discovery while peers are incomplete", async () => {
  const allNo = Object.fromEntries(candidates.map((item) => [item.id, "no"]));
  const individual = room([
    { choices: allNo },
    { choices: {}, submittedAt: null },
  ]);
  assert.equal(canOpenPrivateDiscovery(individual, "creator"), true);
  assert.equal(resultAction(individual, "creator"), "private-discovery");

  const discoveryPage = await readFile(new URL("../miniapp/src/pages/discovery/index.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(discoveryPage, /canOpenPrivateDiscovery/);
});

test("an incomplete round waits and a completed round exposes deterministic named conflict reasons", () => {
  const incomplete = room([{ submittedAt: null, choices: {} }]);
  assert.equal(isCompletedParticipantRound(incomplete), false);
  assert.equal(resultAction(incomplete, "creator"), "wait");

  const split = room([
    { choices: Object.fromEntries(candidates.map((item, index) => [item.id, index < 6 ? "no" : "okay"])) },
    { choices: Object.fromEntries(candidates.map((item, index) => [item.id, index < 6 ? "okay" : "no"])) },
  ]);
  const conflict = diagnoseParticipantConflict(split);
  assert.match(conflict[0].message, /小安/);
  assert.match(conflict[1].message, /小北/);
  assert.doesNotMatch(conflict.map((item) => item.message).join(" "), /creator|member-b/);
});

test("no-result has an immediate deterministic learned summary when the insight service is unavailable", () => {
  const allNo = Object.fromEntries(candidates.map((item) => [item.id, "no"]));
  const conflicted = room([{ choices: allNo }, {}]);
  const insight = deterministicRoundInsight(conflicted);
  assert.equal(insight.mode, "deterministic");
  assert.match(insight.learned, /展览|陶艺|尚未形成/);
  assert.match(insight.conflict, /小安/);
  assert.match(insight.nextRound, /提名|反馈/);
});

test("deterministic diagnosis includes duration and dietary hard limits from participant data", () => {
  const constrained = room([
    { setting: "不吃辣" },
    {},
  ], { candidates: candidates.map((item) => ({ ...item, durationMinutes: 240, features: { ...item.features, nonSpicyAvailable: false } })) });
  const conflict = diagnoseParticipantConflict(constrained);
  assert.ok(conflict.some((item) => item.type === "duration" && /可用时间/.test(item.message)));
  assert.ok(conflict.some((item) => item.type === "no_spicy" && /不吃辣/.test(item.message)));
});

test("the smallest commute relaxation belongs only to the affected member", () => {
  const commuteCandidates = candidates.map((item, index) => ({ ...item, estimatedTravelMinutes: 46 + index }));
  const commuteRoom = room([
    { commuteLabel: "≤ 30 分钟" },
    { commuteLabel: "不限" },
  ], { candidates: commuteCandidates, currentRound: 3 });
  const suggestion = suggestParticipantCommuteRelaxation(commuteRoom);
  assert.deepEqual(suggestion, {
    memberId: "creator",
    memberName: "小安",
    currentMinutes: 30,
    suggestedMinutes: 31,
    addedMinutes: 1,
    restoredCandidateCount: 1,
  });
  assert.equal(resultAction(commuteRoom, "creator"), "edit-commute");
  assert.equal(resultAction(commuteRoom, "member-b"), "wait");
});

test("optional commute negotiation never hides a server-permitted creator advance", () => {
  const commuteCandidates = candidates.map((item, index) => ({ ...item, estimatedTravelMinutes: 46 + index }));
  const recoverable = room([
    { commuteLabel: "≤ 30 分钟", refreshRequestRound: 1, privateCandidates: commuteCandidates.slice(0, 3), privateDiscoveryCompleted: true },
    { commuteLabel: "不限", refreshRequestRound: 1, privateCandidates: commuteCandidates.slice(0, 3), privateDiscoveryCompleted: true },
  ], { candidates: commuteCandidates });
  assert.ok(suggestParticipantCommuteRelaxation(recoverable));
  assert.equal(resultAction(recoverable, "creator"), "advance");
});

test("optional commute negotiation never replaces the actual pending recovery message", () => {
  const commuteCandidates = candidates.map((item, index) => ({ ...item, estimatedTravelMinutes: 46 + index }));
  const pending = room([
    { commuteLabel: "≤ 30 分钟", refreshRequestRound: 1, privateCandidates: commuteCandidates.slice(0, 3), privateDiscoveryCompleted: true },
    { commuteLabel: "不限", refreshRequestRound: null },
  ], { candidates: commuteCandidates });
  assert.ok(suggestParticipantCommuteRelaxation(pending));
  assert.equal(resultWaitMessage(pending), "等待小北完成本轮恢复操作");
  pending.currentRound = 3;
  assert.equal(resultWaitMessage(pending), "等待 小安 确认通勤调整");
});

test("commute adjustment is not offered when relaxing it cannot restore a vetoed candidate", () => {
  const allNo = Object.fromEntries(candidates.map((item) => [item.id, "no"]));
  const vetoedRoom = room([
    { choices: allNo, commuteLabel: "≤ 30 分钟" },
    { choices: Object.fromEntries(candidates.map((item) => [item.id, "okay"])) },
  ], { candidates: candidates.map((item) => ({ ...item, estimatedTravelMinutes: 60 })) });
  assert.equal(suggestParticipantCommuteRelaxation(vetoedRoom), null);
  assert.equal(resultAction(vetoedRoom, "creator"), "private-discovery");
});

test("private nomination is a clearable single selection and native sharing contains only the room code", () => {
  assert.equal(togglePrivateNomination(null, "one"), "one");
  assert.equal(togglePrivateNomination("one", "two"), "two");
  assert.equal(togglePrivateNomination("one", "one"), null);
  assert.deepEqual(roomShareCard("ABC123", "activity"), {
    title: "一起决定周末去哪玩",
    path: "/pages/home/index?room=ABC123",
  });
  assert.deepEqual(roomShareCard("ABC123", "dining"), {
    title: "一起决定这顿饭吃什么",
    path: "/pages/home/index?room=ABC123",
  });
  assert.doesNotMatch(roomShareCard("ABC123", "activity").path, /token|member|openid|access/i);
});

test("result services use the deployed recovery, insight, explain, advance, and commute contracts", async () => {
  const calls = [];
  const membership = { roomCode: "ABC123", memberId: "creator", memberToken: "secret" };
  const request = async (path, options = {}) => {
    calls.push({ path, options });
    if (path === "/api/rounds" && options.data.action === "private-discovery") return { ok: true, candidates: candidates.slice(0, 3) };
    if (path === "/api/insights") return { insight: { mode: "deterministic", learned: "学到了偏好", conflict: "冲突", nextRound: "下一轮" } };
    if (path === "/api/explain") return { explanation: { headline: "平衡", reasoning: "兼顾大家", tradeoff: "通勤略有差异" }, mode: "deepseek" };
    return { ok: true, currentRound: 2 };
  };
  const rounds = createRoundsService({ request });
  const members = createMembersService({ request, saveMembership() {} });
  const ranking = participantRankings(room())[0];

  assert.equal((await rounds.requestPrivateDiscovery(membership, 1)).length, 3);
  await rounds.nominatePrivateCandidate(membership, 1, null);
  await rounds.loadRoundInsight(membership);
  await rounds.loadExplanation(membership, room(), [ranking]);
  await rounds.advanceRound(membership, 1);
  await members.relaxCommute(membership, 1, 46);

  assert.deepEqual(calls.map(({ path, options }) => ({ path, method: options.method, data: options.data, timeout: options.timeout })), [
    { path: "/api/rounds", method: "POST", data: { action: "request", expectedRound: 1, requested: true }, timeout: undefined },
    { path: "/api/rounds", method: "POST", data: { action: "private-discovery", expectedRound: 1 }, timeout: undefined },
    { path: "/api/rounds", method: "POST", data: { action: "nominate", expectedRound: 1, candidateId: null }, timeout: undefined },
    { path: "/api/insights", method: "POST", data: {}, timeout: 20_000 },
    {
      path: "/api/explain",
      method: "POST",
      timeout: 50_000,
      data: {
        city: "上海",
        kind: "activity",
        members: [{ budget: "不限", commute: "不限" }, { budget: "不限", commute: "不限" }],
        candidates: [{ name: "第一选择", groupFit: 91, minUtility: 94, meanUtility: 94, geoMean: 94, evidence: ["2/2 位成员明确喜欢", "最低成员满意度 94", "Nash 群体效用 94"] }],
      },
    },
    { path: "/api/rounds", method: "POST", data: { action: "advance", expectedRound: 1 }, timeout: undefined },
    { path: "/api/members", method: "PATCH", data: { action: "relax-commute", expectedRound: 1, minutes: 46 }, timeout: undefined },
  ]);
});

test("private discovery retries a lost success response and accepts the server-reused three cards", async () => {
  const membership = { roomCode: "ABC123", memberId: "creator", memberToken: "secret" };
  let privateCalls = 0;
  const rounds = createRoundsService({
    request: async (_path, options) => {
      if (options.data.action === "request") return { ok: true, currentRound: 1 };
      privateCalls += 1;
      if (privateCalls === 1) throw new Error("response lost after save");
      return { ok: true, reused: true, candidates: candidates.slice(0, 3) };
    },
  });

  await assert.rejects(() => rounds.requestPrivateDiscovery(membership, 1), /response lost/);
  assert.equal((await rounds.requestPrivateDiscovery(membership, 1)).length, 3);
  assert.equal(privateCalls, 2);
});
