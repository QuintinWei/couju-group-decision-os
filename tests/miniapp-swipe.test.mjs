import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  candidateDisplayFacts,
  candidateImageUrl,
  canSubmitSharedRound,
  createSubmissionGate,
  recordChoice,
  rejectionReasonOptions,
  submitWithRoundRecovery,
} from "../miniapp/src/domain/swipe.ts";
import { createRoundsService } from "../miniapp/src/services/rounds-core.ts";

const candidateIds = Array.from({ length: 12 }, (_, index) => `candidate-${index}`);

test("candidate presentation includes district, known per-person price, commute, and an absolute image URL", () => {
  assert.deepEqual(candidateDisplayFacts({
    city: "上海",
    district: "静安区",
    address: "南京西路",
    priceValue: 148,
    priceLabel: "¥148 / 人",
    estimatedTravelMinutes: 26,
  }), ["静安区", "¥148 / 人", "预计通勤 26 分钟"]);
  assert.equal(candidateImageUrl("/candidates/food.jpg", "https://couju.example/"), "https://couju.example/candidates/food.jpg");
  assert.equal(candidateImageUrl("https://images.example/food.jpg", "https://couju.example"), "https://images.example/food.jpg");
});

test("only one choice for every one of the twelve current candidates can submit", () => {
  const choices = Object.fromEntries(candidateIds.slice(0, 11).map((id) => [id, "okay"]));
  assert.equal(canSubmitSharedRound(candidateIds, choices), false);

  choices[candidateIds[11]] = "like";
  assert.equal(canSubmitSharedRound(candidateIds, choices), true);
  assert.equal(canSubmitSharedRound(candidateIds.slice(0, 11), choices), false);
  assert.equal(canSubmitSharedRound(candidateIds, { ...choices, stale: "no" }), false);
  assert.equal(canSubmitSharedRound(candidateIds, { ...choices, [candidateIds[0]]: "neutral" }), false);
});

test("changing a rejection to a non-rejection clears its old reason", () => {
  const rejected = recordChoice({ choices: {}, reasons: {} }, "candidate-0", "no", { code: "place", detail: "排队" });
  assert.deepEqual(rejected, {
    choices: { "candidate-0": "no" },
    reasons: { "candidate-0": { code: "place", detail: "排队" } },
  });

  const liked = recordChoice(rejected, "candidate-0", "like");
  assert.deepEqual(liked, { choices: { "candidate-0": "like" }, reasons: {} });
});

test("closing rejection feedback can retain the reject without requiring a reason", () => {
  const rejected = recordChoice({ choices: {}, reasons: {} }, "candidate-0", "no");
  assert.deepEqual(rejected, { choices: { "candidate-0": "no" }, reasons: {} });
});

test("rejection choices use the required labels while producing server-valid reason records", () => {
  assert.deepEqual(rejectionReasonOptions("dining"), [
    { key: "queue", label: "排队太久", reason: { code: "place", detail: "排队" } },
    { key: "category", label: "不喜欢这个口味 / 菜系", reason: { code: "category" } },
    { key: "environment", label: "环境不合适", reason: { code: "place", detail: "环境" } },
    { key: "distance", label: "距离太远", reason: { code: "distance" } },
  ]);
  assert.deepEqual(rejectionReasonOptions("activity"), [
    { key: "intensity", label: "活动强度不合适", reason: { code: "other", detail: "活动强度" } },
    { key: "category", label: "对这种活动没兴趣", reason: { code: "category" } },
    { key: "environment", label: "环境不合适", reason: { code: "place", detail: "环境" } },
    { key: "distance", label: "距离太远", reason: { code: "distance" } },
  ]);
  assert.equal(rejectionReasonOptions("dining").some((option) => option.reason.code === "price"), false);
});

test("submission gate coalesces duplicate taps, stays closed after success, and reopens after failure", async () => {
  const gate = createSubmissionGate();
  let calls = 0;
  let release;
  const pendingTask = () => {
    calls += 1;
    return new Promise((resolve) => { release = resolve; });
  };

  const first = gate.run(pendingTask);
  const duplicate = gate.run(pendingTask);
  assert.strictEqual(duplicate, first);
  assert.equal(calls, 1);
  release("ok");
  assert.equal(await first, "ok");
  assert.strictEqual(gate.run(pendingTask), first);
  assert.equal(calls, 1);

  const retryableGate = createSubmissionGate();
  await assert.rejects(retryableGate.run(async () => { throw new Error("offline"); }), /offline/);
  assert.equal(await retryableGate.run(async () => "retried"), "retried");
});

test("a 409 reloads the current round while other failures remain retryable", async () => {
  let reloads = 0;
  assert.deepEqual(await submitWithRoundRecovery({
    submit: async () => { throw { status: 409, message: "房间已进入下一轮" }; },
    reload: async () => { reloads += 1; },
  }), { kind: "stale" });
  assert.equal(reloads, 1);

  await assert.rejects(submitWithRoundRecovery({
    submit: async () => { throw new Error("网络失败"); },
    reload: async () => { reloads += 1; },
  }), /网络失败/);
  assert.equal(reloads, 1);
});

test("round service posts the exact member submission contract without an AI extraction request", async () => {
  const calls = [];
  const request = async (path, options = {}) => {
    calls.push({ path, options });
    return { ok: true };
  };
  const membership = { roomCode: "ABC123", memberId: "member-a", memberToken: "secret-a" };
  const room = {
    currentRound: 2,
    candidates: candidateIds.map((id) => ({ id })),
  };
  const member = {
    budgetLabel: "≤ ¥150",
    commuteLabel: "≤ 60 分钟",
    setting: "安静聊天",
    note: "尽量少排队",
    extraction: { mode: "rules", hardConstraints: [] },
  };
  const choices = Object.fromEntries(candidateIds.map((id, index) => [id, index % 3 === 0 ? "no" : index % 3 === 1 ? "okay" : "like"]));
  const rejectionReasons = { "candidate-0": { code: "place", detail: "排队" } };

  await createRoundsService({ request }).submitSharedRound(membership, room, member, choices, rejectionReasons);

  assert.deepEqual(calls, [{
    path: "/api/members",
    options: {
      method: "PATCH",
      membership,
      data: {
        expectedRound: 2,
        budgetLabel: "≤ ¥150",
        commuteLabel: "≤ 60 分钟",
        setting: "安静聊天",
        note: "尽量少排队",
        extraction: { mode: "rules", hardConstraints: [] },
        choices,
        rejectionReasons,
      },
    },
  }]);
});

test("native shared-card UI keeps accessible choices and the optional half-screen rejection flow", async () => {
  const [card, sheet, page, config] = await Promise.all([
    readFile(new URL("../miniapp/src/components/CandidateCard/index.tsx", import.meta.url), "utf8"),
    readFile(new URL("../miniapp/src/components/RejectionSheet/index.tsx", import.meta.url), "utf8"),
    readFile(new URL("../miniapp/src/pages/swipe/index.tsx", import.meta.url), "utf8"),
    readFile(new URL("../miniapp/src/pages/swipe/index.config.ts", import.meta.url), "utf8"),
  ]);

  assert.match(card, /<Image/);
  assert.match(card, />不喜欢</);
  assert.match(card, />一般</);
  assert.match(card, />喜欢</);
  assert.match(card, /current\} \/ \{total\}/);
  assert.match(sheet, /rejectionReasonOptions/);
  assert.match(sheet, /暂不填写/);
  assert.match(sheet, /rejection-sheet/);
  assert.match(page, /createSubmissionGate/);
  assert.match(page, /submitWithRoundRecovery/);
  assert.match(page, /retrySubmit/);
  assert.match(config, /12 张共享卡/);
});
