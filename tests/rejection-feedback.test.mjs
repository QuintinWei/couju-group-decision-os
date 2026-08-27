import assert from "node:assert/strict";
import test from "node:test";
import { feedbackWeight, rejectionReasonOptions, sanitizeRejectionReasons, validateRejectionReasons } from "../lib/rejection-feedback.ts";

test("rejection reasons omit price because shared cards already pass every member budget", () => {
  assert.deepEqual(rejectionReasonOptions("dining").map((item) => item.label), ["太远", "不喜欢这个菜系", "只是这家不合适"]);
  assert.deepEqual(rejectionReasonOptions("activity").map((item) => item.label), ["太远", "不喜欢这种活动", "只是这个地点不合适"]);
});

test("distance, price and place rejection do not punish the category", () => {
  assert.equal(feedbackWeight("no", "distance"), 0);
  assert.equal(feedbackWeight("no", "price"), 0);
  assert.equal(feedbackWeight("no", "place"), 0);
  assert.equal(feedbackWeight("no", "category"), -1.5);
  assert.equal(feedbackWeight("no", null), -0.5);
});

test("rejection reasons are optional, bounded and only allowed for rejected current cards", () => {
  const ids = ["a", "b"];
  const choices = { a: "no", b: "like" };
  assert.equal(validateRejectionReasons({ a: { code: "distance" } }, ids, choices), true);
  assert.equal(validateRejectionReasons({}, ids, choices), true);
  assert.equal(validateRejectionReasons({ b: { code: "category" } }, ids, choices), false);
  assert.equal(validateRejectionReasons({ x: { code: "place" } }, ids, choices), false);
  assert.equal(validateRejectionReasons({ a: { code: "other", detail: "x".repeat(121) } }, ids, choices), false);
});

test("stale reasons are removed when a card is no longer rejected or leaves the shared pool", () => {
  assert.deepEqual(sanitizeRejectionReasons(
    { a: { code: "category" }, b: { code: "distance" }, old: { code: "price" } },
    ["a", "b"],
    { a: "no", b: "like" },
  ), { a: { code: "category" } });
});
