import assert from "node:assert/strict";
import test from "node:test";
import { getDemoCandidates } from "../lib/couju.ts";
import { canRequestPrivateDiscovery, privateDiscoveryFailure, privateDiscoveryRequestPlan, privateNominationAction, togglePrivateNomination } from "../lib/private-discovery-flow.ts";
import { toJoinRoom, toParticipantRoom } from "../lib/public-room.ts";

const shared = getDemoCandidates("上海", "activity").slice(0, 12);
const allNo = Object.fromEntries(shared.map((card) => [card.id, "no"]));

test("the twelfth all-no choice is the only client branch that offers private discovery", () => {
  assert.equal(canRequestPrivateDiscovery(shared, allNo), true);
  assert.equal(canRequestPrivateDiscovery(shared, { ...allNo, [shared[11].id]: "okay" }), false);
  assert.equal(canRequestPrivateDiscovery(shared.slice(0, 11), allNo), false);
});

test("private discovery saves choices before requesting a refresh and loading the private cards", () => {
  const plan = privateDiscoveryRequestPlan();
  assert.deepEqual(plan, [
    "save-choices",
    { action: "request", requested: true },
    { action: "private-discovery" },
  ]);
});

test("private nomination is a single-select toggle and skip sends a null nomination without undoing refresh", () => {
  assert.equal(togglePrivateNomination(null, "one"), "one");
  assert.equal(togglePrivateNomination("one", "two"), "two");
  assert.equal(togglePrivateNomination("one", "one"), null);
  assert.deepEqual(privateNominationAction(null), { action: "nominate", candidateId: null });
  assert.deepEqual(privateDiscoveryRequestPlan()[1], { action: "request", requested: true });
});

test("failed private discovery returns to results instead of the removed AI field page", () => {
  assert.deepEqual(privateDiscoveryFailure("temporary failure"), { stage: "results", message: "temporary failure", retryable: true });
});

test("the unauthenticated join DTO exposes only room summary counts, never member names", () => {
  const privateCard = { ...shared[0], id: "private-card-id", source: { ...shared[0].source, providerId: "private-poi-id" } };
  const room = {
    code: "ABC123",
    config: { kind: "activity", city: "上海", dateRange: { start: "2026-08-24", end: "2026-08-24" }, preferredPeriods: ["evening"], durationMinutes: 180, resolvedSchedule: { startAt: "2026-08-24T18:00:00+08:00", endAt: "2026-08-24T21:00:00+08:00", attendeeIds: ["member"] }, date: "2026-08-24", startTime: "18:00", endTime: "21:00", people: 2 },
    candidates: shared,
    meta: { mode: "demo", label: "test", fetchedAt: "2026-08-24T00:00:00.000Z" },
    currentRound: 1,
    roundHistory: [],
    createdAt: "2026-08-24T00:00:00.000Z",
    updatedAt: "2026-08-24T00:00:00.000Z",
    members: [{ id: "member", name: "成员", origin: "静安寺", originLocation: null, budgetLabel: "不限", commuteLabel: "不限", setting: "都可以", note: "", extraction: null, choices: { [shared[0].id]: "no" }, submittedAt: "2026-08-24T00:00:00.000Z", availability: [], refreshRequestRound: 1, privateCandidates: [privateCard], nominatedCandidate: privateCard }],
  };

  const joinRoom = toJoinRoom(room);
  assert.deepEqual(joinRoom, {
    code: "ABC123",
    title: "周末去哪玩",
    kind: "activity",
    city: "上海",
    date: "2026-08-24",
    startTime: "18:00",
    endTime: "21:00",
    dateRange: { start: "2026-08-24", end: "2026-08-24" },
    preferredPeriods: ["evening"],
    durationMinutes: 180,
    resolvedSchedule: { startAt: "2026-08-24T18:00:00+08:00", endAt: "2026-08-24T21:00:00+08:00", attendeeIds: ["member"] },
    targetCount: 2,
    joinedCount: 1,
    status: "open",
  });
  assert.doesNotMatch(JSON.stringify(joinRoom), /成员/);
  assert.doesNotMatch(JSON.stringify(joinRoom), /origin|location|note|extraction|choices|budget|commute|token|private|candidate|name/i);
});

test("authenticated participant DTO keeps private cards isolated from peers", () => {
  const privateCard = { ...shared[0], id: "private-card-id", source: { ...shared[0].source, providerId: "private-poi-id" } };
  const room = {
    code: "ABC123", config: { kind: "activity", city: "上海", date: "2026-08-24", startTime: "18:00", endTime: "21:30", people: 2 }, candidates: shared,
    meta: { mode: "demo", label: "test", fetchedAt: "2026-08-24T00:00:00.000Z" }, currentRound: 1, roundHistory: [{ round: 0, privateRejectedCandidateIds: ["historical-private-card"], privateCategoryPenalties: { "私人类别": -1.5 } }], createdAt: "2026-08-24T00:00:00.000Z", updatedAt: "2026-08-24T00:00:00.000Z",
    members: [
      { id: "one", name: "一", origin: "静安寺", originLocation: null, budgetLabel: "不限", commuteLabel: "不限", setting: "都可以", note: "", extraction: null, choices: { [shared[0].id]: "no" }, submittedAt: "2026-08-24T00:00:00.000Z", refreshRequestRound: 1, privateCandidates: [privateCard, { ...privateCard, id: "private-two", source: { ...privateCard.source, providerId: "private-poi-two" } }, { ...privateCard, id: "private-three", source: { ...privateCard.source, providerId: "private-poi-three" } }], nominatedCandidate: privateCard, privateDecisionRound: 1 },
      { id: "two", name: "二", origin: "徐家汇", originLocation: null, budgetLabel: "不限", commuteLabel: "不限", setting: "都可以", note: "", extraction: null, choices: {}, submittedAt: null, refreshRequestRound: null, privateCandidates: [privateCard], nominatedCandidate: privateCard, privateDecisionRound: null },
    ],
  };
  const dto = toParticipantRoom(room, "one");
  assert.equal(dto.nominationCount, 2);
  assert.equal(dto.members[0].privateCandidates.length, 3);
  assert.equal(dto.members[0].privateDiscoveryCompleted, true);
  assert.equal(dto.members[1].privateDiscoveryCompleted, false);
  assert.equal("privateDecisionRound" in dto.members[0], false);
  assert.equal("privateDecisionRound" in dto.members[1], false);
  assert.equal("privateCandidates" in dto.members[1], false);
  assert.doesNotMatch(JSON.stringify(dto.members[1]), /private-card-id|private-poi-id/);
  assert.deepEqual(Object.keys(dto.members[1]).sort(), [
    "availabilitySubmitted",
    "constraintsReady",
    "id",
    "locationReady",
    "name",
    "privateDiscoveryCompleted",
    "refreshRequestRound",
    "submittedAt",
  ]);
  assert.equal(dto.members[1].locationReady, false);
  assert.equal(dto.members[1].availabilitySubmitted, false);
  assert.equal(dto.decision, null);
  assert.deepEqual(dto.roundHistory, [{ round: 0 }]);
  assert.doesNotMatch(JSON.stringify(dto), /historical-private-card|私人类别/);
  assert.doesNotMatch(
    JSON.stringify(dto.members[1]),
    /origin|location"|budget|commute|setting|note|extraction|choices|rejectionReasons|availability"|nominatedCandidate/i,
  );
});

test("completed participant DTO publishes only a server-computed decision while peer inputs stay redacted", () => {
  const choices = Object.fromEntries(shared.map((candidate, index) => [candidate.id, index === 0 ? "like" : "okay"]));
  const makeMember = (id, name, origin, commuteLabel) => ({
    id,
    userId: `user-${id}`,
    name,
    origin,
    originLocation: null,
    budgetLabel: "≤ ¥300/人",
    commuteLabel,
    constraintsReady: true,
    setting: "安静聊天",
    note: `${name} 的私人补充`,
    extraction: { hardConstraints: [], softPreferences: [], clarificationQuestion: null, mode: "rules", model: null, warning: null },
    choices,
    rejectionReasons: {},
    submittedAt: "2026-08-24T00:00:00.000Z",
    availability: [],
    refreshRequestRound: null,
    privateCandidates: [],
    nominatedCandidate: null,
    privateDecisionRound: null,
  });
  const room = {
    code: "ABC123",
    config: {
      kind: "activity", city: "上海", people: 2,
      dateRange: { start: "2026-08-24", end: "2026-08-24" }, preferredPeriods: ["evening"], durationMinutes: 180,
      resolvedSchedule: { startAt: "2026-08-24T18:00:00+08:00", endAt: "2026-08-24T21:00:00+08:00", attendeeIds: ["one", "two"] },
      date: "2026-08-24", startTime: "18:00", endTime: "21:30",
    },
    candidates: shared,
    meta: { mode: "demo", label: "test", fetchedAt: "2026-08-24T00:00:00.000Z" },
    currentRound: 1,
    roundHistory: [],
    createdAt: "2026-08-24T00:00:00.000Z",
    updatedAt: "2026-08-24T00:00:00.000Z",
    members: [makeMember("one", "一", "静安寺", "≤ 30 分钟"), makeMember("two", "二", "徐家汇", "≤ 45 分钟")],
  };

  const dto = toParticipantRoom(room, "one");
  assert.ok(dto.decision);
  assert.ok(dto.decision.rankings.length > 0);
  assert.deepEqual(dto.decision.conflicts, []);
  assert.equal(dto.decision.rankings[0].memberUtilities.length, 2);
  assert.ok(dto.decision.rankings[0].memberUtilities.every((utility) => utility.travelMinutes === null));
  assert.equal("choices" in dto.members[0], true);
  assert.equal("choices" in dto.members[1], false);
  assert.doesNotMatch(JSON.stringify(dto.members[1]), /徐家汇|45 分钟|私人补充/);
});
