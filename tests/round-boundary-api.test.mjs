import assert from "node:assert/strict";
import test from "node:test";

import { handleInsightRequest } from "../lib/insight-api.ts";

function candidate(index) {
  return {
    id: `candidate-${index}`,
    kind: "activity",
    city: "上海",
    type: "展览",
    name: `候选 ${index}`,
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
    source: { mode: "demo", label: "测试候选库", fetchedAt: "2026-09-01T00:00:00.000Z", providerId: `provider-${index}` },
    features: { indoor: true, quiet: true, conversationFriendly: true, nonSpicyAvailable: true, queueRisk: "low" },
  };
}

const candidates = Array.from({ length: 12 }, (_, index) => candidate(index + 1));
const allNo = Object.fromEntries(candidates.map((item) => [item.id, "no"]));
const privateBatch = candidates.slice(0, 3);

function member(id, overrides = {}) {
  return {
    id,
    userId: null,
    name: id === "creator" ? "房主" : "成员",
    origin: "静安寺",
    originLocation: null,
    budgetLabel: "不限",
    commuteLabel: "不限",
    constraintsReady: true,
    setting: "都可以",
    note: "",
    extraction: null,
    choices: allNo,
    rejectionReasons: {},
    submittedAt: "2026-09-01T10:00:00.000Z",
    availability: [],
    refreshRequestRound: 1,
    privateCandidates: privateBatch,
    nominatedCandidate: null,
    privateDecisionRound: null,
    ...overrides,
  };
}

function room(members) {
  return {
    code: "ABC123",
    config: {
      kind: "activity",
      city: "上海",
      people: 2,
      dateRange: { start: "2026-09-05", end: "2026-09-05" },
      preferredPeriods: ["evening"],
      durationMinutes: 120,
      resolvedSchedule: null,
      date: "2026-09-05",
      startTime: "18:00",
      endTime: "21:00",
    },
    candidates,
    meta: { mode: "demo", label: "测试", fetchedAt: "2026-09-01T00:00:00.000Z" },
    currentRound: 1,
    roundHistory: [],
    members,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T10:00:00.000Z",
  };
}

test("authenticated insight calls reject an incomplete shared round", async () => {
  const storedRoom = room([member("creator"), member("friend", { choices: {}, submittedAt: null })]);
  const response = await handleInsightRequest(
    { roomCode: "ABC123", memberId: "creator", token: "member-token" },
    async () => storedRoom,
  );

  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /本轮.*完成|完成.*本轮/);
});
