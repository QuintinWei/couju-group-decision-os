import assert from "node:assert/strict";
import test from "node:test";
import { allCurrentMembersSubmitted, collectAdvanceExcludedIds, collectCurrentPrivateRejectedIds, evaluateAdvanceGate, evaluatePrivateDiscoveryGate, executeGuardedGeneration, validateRoundActionPayload } from "../lib/round-api.ts";

const candidates = Array.from({ length: 12 }, (_, index) => ({ id: `candidate-${index}`, source: { providerId: `provider-${index}` } }));
const submitted = { id: "creator", submittedAt: "2026-08-24T00:00:00.000Z" };

test("non-creator receives 403 before the candidate generator runs", async () => {
  let generated = false;
  const gate = evaluateAdvanceGate({ currentRound: 1, members: [submitted], candidates }, "member", 1);
  const result = await executeGuardedGeneration(gate, async () => { generated = true; return candidates; }, async () => ({ ok: true }));
  assert.deepEqual(result, { ok: false, status: 403, code: "NOT_CREATOR" });
  assert.equal(generated, false);
});

test("advance gate returns stale and round-three status contracts", () => {
  assert.deepEqual(evaluateAdvanceGate({ currentRound: 2, members: [submitted], candidates }, "creator", 1), { ok: false, status: 409, code: "STALE_ROUND" });
  assert.deepEqual(evaluateAdvanceGate({ currentRound: 3, members: [submitted], candidates }, "creator", 3), { ok: false, status: 429, code: "MAX_ROUNDS" });
});

test("private discovery gate requires all twelve rejections", () => {
  const allNo = Object.fromEntries(candidates.map((candidate) => [candidate.id, "no"]));
  assert.deepEqual(evaluatePrivateDiscoveryGate(candidates.map((candidate) => candidate.id), allNo), { ok: true });
  assert.deepEqual(evaluatePrivateDiscoveryGate(candidates.map((candidate) => candidate.id), { ...allNo, [candidates[0].id]: "okay" }), { ok: false, status: 422, code: "PRIVATE_INELIGIBLE" });
});

test("generation failure does not invoke mutation", async () => {
  let mutated = false;
  const gate = evaluateAdvanceGate({ currentRound: 1, members: [submitted], candidates }, "creator", 1);
  const result = await executeGuardedGeneration(gate, async () => { throw new Error("candidate service unavailable"); }, async () => { mutated = true; return { ok: true }; });
  assert.deepEqual(result, { ok: false, status: 422, code: "GENERATION_FAILED" });
  assert.equal(mutated, false);
});

test("unexpected storage failure is distinct from candidate generation failure", async () => {
  const gate = evaluateAdvanceGate({ currentRound: 1, members: [submitted], candidates }, "creator", 1);
  const result = await executeGuardedGeneration(gate, async () => candidates, async () => { throw new Error("D1 unavailable"); });
  assert.deepEqual(result, { ok: false, status: 503, code: "SERVICE_FAILED" });
});

test("membership helper rejects an incomplete current membership", () => {
  assert.equal(allCurrentMembersSubmitted([submitted, { id: "late", submittedAt: null }]), false);
  assert.equal(allCurrentMembersSubmitted([submitted, { id: "member", submittedAt: "2026-08-24T00:00:00.000Z" }]), true);
});

test("round payload validation rejects coercion and non-boolean refresh values", () => {
  const base = { action: "request", roomCode: "ABC123", memberId: "member", token: "token" };
  assert.deepEqual(validateRoundActionPayload({ ...base, expectedRound: true }), { ok: false, status: 400, code: "MALFORMED" });
  assert.deepEqual(validateRoundActionPayload({ ...base, expectedRound: 1, requested: "yes" }), { ok: false, status: 400, code: "MALFORMED" });
});

test("current private cards are excluded unless their owner nominates them", () => {
  const rejected = collectCurrentPrivateRejectedIds([
    {
      privateCandidates: [
        { id: "private-rejected", source: { providerId: "private-rejected" } },
        { id: "private-nominated", source: { providerId: "private-nominated" } },
      ],
      nominatedCandidate: { id: "private-nominated", source: { providerId: "private-nominated" } },
    },
  ]);
  assert.deepEqual([...rejected], ["private-rejected"]);
});

test("advance planning cannot put a currently rejected private card in the next shared pool", () => {
  const excluded = collectAdvanceExcludedIds({
    currentCandidates: [{ id: "current" }],
    historicalCandidateIds: ["prior-round"],
    historicalPrivateRejectedIds: ["archived-private"],
    feedbackRejectedIds: [],
    currentPrivateMembers: [{
      privateCandidates: [{ id: "current-private-rejected" }, { id: "current-private-nominated" }],
      nominatedCandidate: { id: "current-private-nominated" },
    }],
  });
  assert.equal(excluded.has("current-private-rejected"), true);
  assert.equal(excluded.has("current-private-nominated"), false);
  assert.equal(excluded.has("prior-round"), true);
  assert.equal(excluded.has("archived-private"), true);
});
