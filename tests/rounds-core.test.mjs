import assert from "node:assert/strict";
import test from "node:test";
import { aggregatePrivateCategoryPenalties, aggregateRoundFeedback, applyCategoryPenalties, buildNextRoundSlots, canRequestPrivateDiscovery, diagnoseRoundConflict, normalizeFeedbackInterestScores, selectQualifiedExploration, RoundCompositionError } from "../lib/rounds.ts";
import { getDemoCandidates } from "../lib/couju.ts";

const candidates = getDemoCandidates("上海", "activity").slice(0, 3);
const members = [
  { id: "one", name: "一", choices: { [candidates[0].id]: "like", [candidates[1].id]: "okay", [candidates[2].id]: "no" }, submittedAt: "2026-08-24T00:00:00.000Z" },
  { id: "two", name: "二", choices: { [candidates[0].id]: "no", [candidates[1].id]: "like", [candidates[2].id]: "no" }, submittedAt: "2026-08-24T00:00:00.000Z" },
];

test("private discovery requires rejecting every shared candidate", () => {
  const ids = Array.from({ length: 12 }, (_, index) => `candidate-${index}`);
  const allNo = Object.fromEntries(ids.map((id) => [id, "no"]));
  assert.equal(canRequestPrivateDiscovery(ids, allNo), true);
  assert.equal(canRequestPrivateDiscovery(ids, { ...allNo, [ids[11]]: "okay" }), false);
  assert.equal(canRequestPrivateDiscovery(ids.slice(0, 11), allNo), false);
  assert.equal(canRequestPrivateDiscovery(["a", "b"], { a: "no", b: "no" }), false);
});

test("group feedback uses like +2, okay +0.5, no -1.5", () => {
  const feedback = aggregateRoundFeedback(candidates, members);
  assert.equal(feedback.categoryScores.get(candidates[0].type), 0.5);
  assert.equal(feedback.categoryScores.get(candidates[1].type), 2.5);
  assert.deepEqual(feedback.rejectedCandidateIds, [candidates[2].id]);
  assert.deepEqual(feedback.seenCandidateIds, candidates.map((candidate) => candidate.id));
});

test("feedback keeps distinct matched interests even when Amap returns the same raw type", () => {
  const source = getDemoCandidates("上海", "activity");
  const sameRawType = [
    { ...source[0], id: "clay", type: "生活服务", matchedInterest: "陶艺泥塑" },
    { ...source[1], id: "climb", type: "生活服务", matchedInterest: "攀岩" },
  ];
  const feedback = aggregateRoundFeedback(sameRawType, [{
    id: "member",
    choices: { clay: "like", climb: "no" },
    submittedAt: "2026-08-24T00:00:00.000Z",
  }]);
  assert.equal(feedback.categoryScores.get("陶艺泥塑"), 2);
  assert.equal(feedback.categoryScores.get("攀岩"), -1.5);
  assert.equal(feedback.categoryScores.has("生活服务"), false);
  const learnScores = normalizeFeedbackInterestScores("activity", feedback.categoryScores);
  assert.equal(learnScores.get("陶艺泥塑"), 2);
  assert.equal(learnScores.get("攀岩"), -1.5);
});

test("every non-nominated private card penalizes its stable category by minus 1.5", () => {
  const privateCards = getDemoCandidates("上海", "activity").slice(0, 3).map((card, index) => ({ ...card, id: `private-${index}`, matchedInterest: ["攀岩", "攀岩", "陶艺泥塑"][index] }));
  const penalties = aggregatePrivateCategoryPenalties([{ privateCandidates: privateCards, nominatedCandidate: privateCards[2] }]);
  assert.deepEqual(Object.fromEntries(penalties), { "攀岩": -3 });
  const learned = applyCategoryPenalties(new Map([["攀岩", 2], ["陶艺泥塑", 0.5]]), penalties);
  assert.deepEqual(Object.fromEntries(learned), { "攀岩": -1, "陶艺泥塑": 0.5 });
});

test("exploration accepts only requested unseen stable categories", () => {
  const source = getDemoCandidates("上海", "activity");
  const pool = [
    { ...source[0], id: "one", matchedInterest: "攀岩" },
    { ...source[1], id: "two", matchedInterest: "陶艺泥塑" },
    { ...source[2], id: "three", matchedInterest: "电影" },
    { ...source[3], id: "four", matchedInterest: "KTV" },
    { ...source[4], id: "seen", matchedInterest: "景点" },
    { ...source[5], id: "unrequested", matchedInterest: "麻将棋牌" },
  ];
  const selected = selectQualifiedExploration(pool, ["攀岩", "陶艺泥塑", "电影", "KTV"], new Set(["景点"]));
  assert.deepEqual(selected.map((card) => card.id), ["one", "two", "three", "four"]);
  assert.throws(() => selectQualifiedExploration(pool.slice(0, 3), ["攀岩", "陶艺泥塑", "电影", "KTV"], new Set()), (error) => error instanceof RoundCompositionError && error.code === "insufficient_exploration");
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
  assert.ok(result.filter((item) => item.segment === "explore").every((item) => exploration.some((candidate) => candidate.id === item.id)));
  assert.equal(new Set(result.map((item) => item.id)).size, 12);
});

test("next round fails explicitly when duplicate pools cannot satisfy twelve unique cards and four genuine explorations", () => {
  const pool = getDemoCandidates("上海", "dining");
  const nominations = pool.slice(0, 2);
  const learned = pool.slice(0, 2);
  const exploration = pool.slice(0, 3);
  assert.throws(() => buildNextRoundSlots(nominations, learned, exploration), (error) => error instanceof RoundCompositionError && error.code === "insufficient_exploration");
  assert.throws(() => buildNextRoundSlots([], pool.slice(0, 3), getDemoCandidates("上海", "activity").slice(0, 4)), (error) => error instanceof RoundCompositionError && error.code === "insufficient_unique_candidates");
});

test("conflict diagnosis reports all-rejected and hard-filter causes", () => {
  const config = { kind: "activity", city: "上海", date: "2026-08-24", startTime: "18:00", endTime: "21:30", people: 2 };
  const rejectedMember = { id: "rejector", name: "拒绝者", origin: "", originLocation: null, budgetLabel: "不限", commuteLabel: "不限", setting: "都可以", note: "", extraction: null, choices: Object.fromEntries(candidates.map((item) => [item.id, "no"])), submittedAt: "2026-08-24T00:00:00.000Z" };
  assert.ok(diagnoseRoundConflict(candidates, [rejectedMember], config).some((reason) => reason.type === "all_rejected"));

  const commute = { ...rejectedMember, choices: Object.fromEntries(candidates.map((item) => [item.id, "okay"])), commuteLabel: "≤ 30 分钟" };
  const commuteCandidates = candidates.map((item) => ({ ...item, estimatedTravelMinutes: 60 }));
  assert.ok(diagnoseRoundConflict(commuteCandidates, [commute], config).some((reason) => reason.type === "commute"));

  const noSpicy = { ...commute, setting: "不吃辣" };
  const spicyCandidates = candidates.map((item) => ({ ...item, features: { ...item.features, nonSpicyAvailable: false } }));
  assert.ok(diagnoseRoundConflict(spicyCandidates, [noSpicy], config).some((reason) => reason.type === "no_spicy"));

  const routeKnown = { ...commute, originLocation: candidates[0].location };
  const routeCandidate = { ...candidates[0], estimatedTravelMinutes: null };
  const routeReasons = diagnoseRoundConflict([routeCandidate], [routeKnown], config);
  assert.equal(routeReasons.some((reason) => reason.type === "unknown_hard_fact"), false);
});

test("conflict diagnosis names a member instead of exposing their internal id", () => {
  const config = { kind: "activity", city: "上海", date: "2026-08-24", startTime: "18:00", endTime: "21:30", people: 2 };
  const member = {
    id: "member-private-id",
    name: "小林",
    choices: Object.fromEntries(candidates.map((item) => [item.id, "no"])),
    submittedAt: "2026-08-24T00:00:00.000Z",
  };
  const reason = diagnoseRoundConflict(candidates, [member], config).find((item) => item.type === "all_rejected");
  assert.match(reason?.message ?? "", /小林/);
  assert.doesNotMatch(reason?.message ?? "", /member-private-id/);
});

test("conflict diagnosis ranks partial member impacts when members jointly eliminate every card", () => {
  const pool = getDemoCandidates("上海", "activity").slice(0, 4);
  const config = { kind: "activity", city: "上海", date: "2026-08-24", startTime: "18:00", endTime: "21:30", people: 2 };
  const members = [
    { id: "a", name: "小安", choices: { [pool[0].id]: "no", [pool[1].id]: "no", [pool[2].id]: "okay", [pool[3].id]: "okay" }, submittedAt: "2026-08-24T00:00:00.000Z" },
    { id: "b", name: "小北", choices: { [pool[0].id]: "okay", [pool[1].id]: "okay", [pool[2].id]: "no", [pool[3].id]: "no" }, submittedAt: "2026-08-24T00:00:00.000Z" },
  ];
  const reasons = diagnoseRoundConflict(pool, members, config);
  assert.deepEqual(reasons.slice(0, 2).map((reason) => [reason.type, reason.memberId, reason.affectedCount]), [
    ["choice_rejection", "a", 2],
    ["choice_rejection", "b", 2],
  ]);
  assert.match(reasons[0].message, /小安/);
  assert.match(reasons[1].message, /小北/);
});
