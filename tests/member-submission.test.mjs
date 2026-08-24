import assert from "node:assert/strict";
import test from "node:test";
import { validateMemberSubmission } from "../lib/member-submission.ts";

const candidateIds = Array.from({ length: 12 }, (_, index) => `candidate-${index}`);
const exactChoices = Object.fromEntries(candidateIds.map((id, index) => [id, index % 3 === 0 ? "like" : index % 3 === 1 ? "okay" : "no"]));

test("a valid submission names the current round and rates exactly all twelve candidates", () => {
  assert.deepEqual(validateMemberSubmission({ expectedRound: 2, currentRound: 2, candidateIds, choices: exactChoices }), { ok: true });
});

test("a stale tab cannot submit choices for a later room round", () => {
  assert.deepEqual(validateMemberSubmission({ expectedRound: 1, currentRound: 2, candidateIds, choices: exactChoices }), { ok: false, code: "STALE_ROUND" });
});

test("submission rejects malformed choice values", () => {
  assert.deepEqual(validateMemberSubmission({ expectedRound: 2, currentRound: 2, candidateIds, choices: { ...exactChoices, [candidateIds[4]]: "love" } }), { ok: false, code: "INVALID_CHOICES" });
});

test("submission rejects missing and extra candidate ids", () => {
  const missing = { ...exactChoices };
  delete missing[candidateIds[0]];
  assert.deepEqual(validateMemberSubmission({ expectedRound: 2, currentRound: 2, candidateIds, choices: missing }), { ok: false, code: "INVALID_CHOICES" });
  assert.deepEqual(validateMemberSubmission({ expectedRound: 2, currentRound: 2, candidateIds, choices: { ...exactChoices, extra: "no" } }), { ok: false, code: "INVALID_CHOICES" });
});

test("submission rejects non-integer expected rounds and non-twelve-card rooms", () => {
  assert.deepEqual(validateMemberSubmission({ expectedRound: 2.5, currentRound: 2, candidateIds, choices: exactChoices }), { ok: false, code: "MALFORMED" });
  assert.deepEqual(validateMemberSubmission({ expectedRound: 2, currentRound: 2, candidateIds: candidateIds.slice(0, 11), choices: exactChoices }), { ok: false, code: "INVALID_SHARED_CANDIDATES" });
});
