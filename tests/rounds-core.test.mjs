import assert from "node:assert/strict";
import test from "node:test";
import { aggregateRoundFeedback, buildNextRoundSlots, canRequestPrivateDiscovery, diagnoseRoundConflict } from "../lib/rounds.ts";
import { getDemoCandidates } from "../lib/couju.ts";

const candidates = getDemoCandidates("上海", "activity").slice(0, 3);
const members = [
  { id: "one", name: "一", choices: { [candidates[0].id]: "like", [candidates[1].id]: "okay", [candidates[2].id]: "no" }, submittedAt: "2026-08-24T00:00:00.000Z" },
  { id: "two", name: "二", choices: { [candidates[0].id]: "no", [candidates[1].id]: "like", [candidates[2].id]: "no" }, submittedAt: "2026-08-24T00:00:00.000Z" },
];

test("private discovery requires rejecting every shared candidate", () => {
  assert.equal(canRequestPrivateDiscovery(["a", "b"], { a: "no", b: "no" }), true);
  assert.equal(canRequestPrivateDiscovery(["a", "b"], { a: "no", b: "okay" }), false);
  assert.equal(canRequestPrivateDiscovery(["a", "b"], { a: "no" }), false);
});

test("group feedback uses like +2, okay +0.5, no -1.5", () => {
  const feedback = aggregateRoundFeedback(candidates, members);
  assert.equal(feedback.categoryScores.get(candidates[0].type), 0.5);
  assert.equal(feedback.categoryScores.get(candidates[1].type), 2.5);
  assert.deepEqual(feedback.rejectedCandidateIds, [candidates[2].id]);
  assert.deepEqual(feedback.seenCandidateIds, candidates.map((candidate) => candidate.id));
});

test("next round keeps nominations, fills learned slots, and reserves four exploration cards", () => {
  const pool = getDemoCandidates("上海", "dining");
  const nominations = pool.slice(0, 2).map((item) => ({ ...item, source: { ...item.source, providerId: `p-${item.id}` } }));
  const learned = pool.slice(2, 10).map((item) => ({ ...item, source: { ...item.source, providerId: `p-${item.id}` } }));
  const exploration = getDemoCandidates("上海", "activity").slice(0, 6).map((item) => ({ ...item, source: { ...item.source, providerId: `p-${item.id}` } }));
  const result = buildNextRoundSlots(nominations, learned, exploration);
  assert.equal(result.length, 12);
  assert.deepEqual(result.slice(0, nominations.length).map((item) => item.id), nominations.map((item) => item.id));
  assert.equal(result.filter((item) => item.segment === "explore").length, 4);
  assert.equal(new Set(result.map((item) => item.id)).size, 12);
});

test("conflict diagnosis reports all-rejected and hard-filter causes", () => {
  const config = { kind: "activity", city: "上海", date: "2026-08-24", startTime: "18:00", endTime: "21:30", people: 2 };
  const rejectedMember = { id: "rejector", name: "拒绝者", origin: "", originLocation: null, budgetLabel: "不限", commuteLabel: "不限", setting: "都可以", note: "", extraction: null, choices: Object.fromEntries(candidates.map((item) => [item.id, "no"])), submittedAt: "2026-08-24T00:00:00.000Z" };
  assert.ok(diagnoseRoundConflict(candidates, [rejectedMember], config).some((reason) => reason.type === "all_rejected"));

  const commute = { ...rejectedMember, choices: Object.fromEntries(candidates.map((item) => [item.id, "okay"])), commuteLabel: "≤ 30 分钟" };
  const commuteCandidates = candidates.map((item) => ({ ...item, estimatedTravelMinutes: 60 }));
  assert.ok(diagnoseRoundConflict(commuteCandidates, [commute], config).some((reason) => reason.type === "commute"));
});
