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

test("failed private discovery returns to a retryable constraints state", () => {
  assert.deepEqual(privateDiscoveryFailure("temporary failure"), { stage: "constraints", message: "temporary failure", retryable: true });
});

test("the unauthenticated join DTO contains only room summary and joined display names", () => {
  const privateCard = { ...shared[0], id: "private-card-id", source: { ...shared[0].source, providerId: "private-poi-id" } };
  const room = {
    code: "ABC123",
    config: { kind: "activity", city: "上海", date: "2026-08-24", startTime: "18:00", endTime: "21:30", people: 2 },
    candidates: shared,
    meta: { mode: "demo", label: "test", fetchedAt: "2026-08-24T00:00:00.000Z" },
    currentRound: 1,
    roundHistory: [],
    createdAt: "2026-08-24T00:00:00.000Z",
    updatedAt: "2026-08-24T00:00:00.000Z",
    members: [{ id: "member", name: "成员", origin: "静安寺", originLocation: null, budgetLabel: "不限", commuteLabel: "不限", setting: "都可以", note: "", extraction: null, choices: { [shared[0].id]: "no" }, submittedAt: "2026-08-24T00:00:00.000Z", refreshRequestRound: 1, privateCandidates: [privateCard], nominatedCandidate: privateCard }],
  };

  const joinRoom = toJoinRoom(room);
  assert.deepEqual(joinRoom, {
    code: "ABC123",
    title: "周末去哪玩",
    kind: "activity",
    city: "上海",
    date: "2026-08-24",
    startTime: "18:00",
    endTime: "21:30",
    targetCount: 2,
    joinedCount: 1,
    joinedNames: ["成员"],
    status: "open",
  });
  assert.doesNotMatch(JSON.stringify(joinRoom), /origin|location|note|extraction|choices|budget|commute|token|private|candidate/i);
});

test("authenticated participant DTO keeps private cards isolated from peers", () => {
  const privateCard = { ...shared[0], id: "private-card-id", source: { ...shared[0].source, providerId: "private-poi-id" } };
  const room = {
    code: "ABC123", config: { kind: "activity", city: "上海", date: "2026-08-24", startTime: "18:00", endTime: "21:30", people: 2 }, candidates: shared,
    meta: { mode: "demo", label: "test", fetchedAt: "2026-08-24T00:00:00.000Z" }, currentRound: 1, roundHistory: [], createdAt: "2026-08-24T00:00:00.000Z", updatedAt: "2026-08-24T00:00:00.000Z",
    members: [
      { id: "one", name: "一", origin: "静安寺", originLocation: null, budgetLabel: "不限", commuteLabel: "不限", setting: "都可以", note: "", extraction: null, choices: { [shared[0].id]: "no" }, submittedAt: "2026-08-24T00:00:00.000Z", refreshRequestRound: 1, privateCandidates: [privateCard], nominatedCandidate: privateCard },
      { id: "two", name: "二", origin: "徐家汇", originLocation: null, budgetLabel: "不限", commuteLabel: "不限", setting: "都可以", note: "", extraction: null, choices: {}, submittedAt: null, refreshRequestRound: null, privateCandidates: [privateCard], nominatedCandidate: privateCard },
    ],
  };
  const dto = toParticipantRoom(room, "one");
  assert.equal(dto.members[0].privateCandidates.length, 1);
  assert.equal("privateCandidates" in dto.members[1], false);
  assert.doesNotMatch(JSON.stringify(dto.members[1]), /private-card-id|private-poi-id/);
});
