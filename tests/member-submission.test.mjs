import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { validateMemberSubmission } from "../lib/member-submission.ts";

const candidateIds = Array.from({ length: 12 }, (_, index) => `candidate-${index}`);
const exactChoices = Object.fromEntries(candidateIds.map((id, index) => [id, index % 3 === 0 ? "like" : index % 3 === 1 ? "okay" : "no"]));

test("a valid submission names the current round and rates exactly all twelve candidates", () => {
  assert.deepEqual(validateMemberSubmission({ expectedRound: 2, currentRound: 2, candidateIds, choices: exactChoices, rejectionReasons: { [candidateIds[2]]: { code: "distance" } } }), { ok: true });
});

test("submission rejects a reason attached to a non-rejected card", () => {
  assert.deepEqual(validateMemberSubmission({ expectedRound: 2, currentRound: 2, candidateIds, choices: exactChoices, rejectionReasons: { [candidateIds[0]]: { code: "category" } } }), { ok: false, code: "INVALID_CHOICES" });
});

test("a stale tab cannot submit choices for a later room round", () => {
  assert.deepEqual(validateMemberSubmission({ expectedRound: 1, currentRound: 2, candidateIds, choices: exactChoices }), { ok: false, code: "STALE_ROUND" });
});

test("a stale submission with prior-card rejection reasons reports stale before validating that old pool", () => {
  const oldChoices = Object.fromEntries(candidateIds.map((id, index) => [`previous-${id}`, index === 0 ? "no" : "okay"]));
  assert.deepEqual(validateMemberSubmission({
    expectedRound: 1,
    currentRound: 2,
    candidateIds,
    choices: oldChoices,
    rejectionReasons: { "previous-candidate-0": { code: "place", detail: "排队" } },
  }), { ok: false, code: "STALE_ROUND" });
});

test("members PATCH checks the stored round before rejection reasons from a prior card pool", async () => {
  const route = await readFile(new URL("../app/api/members/route.ts", import.meta.url), "utf8");
  const staleCheck = route.indexOf("expectedRound !== roomForValidation.currentRound");
  const rejectionValidation = route.indexOf("if (!validateRejectionReasons");
  assert.ok(staleCheck >= 0, "the endpoint must compare expectedRound with the stored currentRound");
  assert.ok(staleCheck < rejectionValidation, "the endpoint must return stale before validating old rejection candidate IDs");
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
