import assert from "node:assert/strict";
import test from "node:test";
import { extractWithRules, getDemoCandidates, rankCandidates } from "../lib/couju.ts";

const config = { kind: "dining", city: "上海", date: "2026-08-23", startTime: "18:00", endTime: "21:30", people: 4 };

test("rule extraction changes with the user's actual sentence", () => {
  const first = extractWithRules("人均 100，晚上 7 点前离开，不吃辣", "dining");
  const second = extractWithRules("想找安静一点、适合聊天的地方", "dining");
  assert.ok(first.hardConstraints.some((item) => item.type === "max_budget" && item.value === "100"));
  assert.ok(first.hardConstraints.some((item) => item.type === "leave_before" && item.value === "19:00"));
  assert.ok(second.softPreferences.some((item) => item.feature === "quiet"));
  assert.equal(second.hardConstraints.length, 0);
});

test("budget, commute, and swipe choices really filter recommendations", () => {
  const candidates = getDemoCandidates("上海", "dining");
  const allOkay = Object.fromEntries(candidates.map((item) => [item.id, "okay"]));
  const ranked = rankCandidates(candidates, { config, choices: allOkay, budgetLabel: "≤ ¥100", commuteLabel: "≤ 30 分钟", setting: "都可以", extraction: null });
  assert.ok(ranked.length > 0);
  assert.ok(ranked.every((item) => item.priceValue !== null && item.priceValue <= 100));
  assert.ok(ranked.every((item) => item.estimatedTravelMinutes !== null && item.estimatedTravelMinutes <= 30));

  const allNo = Object.fromEntries(candidates.map((item) => [item.id, "no"]));
  assert.equal(rankCandidates(candidates, { config, choices: allNo, budgetLabel: "不限", commuteLabel: "不限", setting: "都可以", extraction: null }).length, 0);
});

test("veto exclusion removes the current winner and recalculates", () => {
  const candidates = getDemoCandidates("上海", "dining");
  const choices = Object.fromEntries(candidates.map((item) => [item.id, item.id.endsWith("veggie") ? "like" : "okay"]));
  const first = rankCandidates(candidates, { config, choices, budgetLabel: "≤ ¥200", commuteLabel: "≤ 45 分钟", setting: "微辣可以", extraction: null });
  assert.ok(first[0]);
  const second = rankCandidates(candidates, { config, choices, budgetLabel: "≤ ¥200", commuteLabel: "≤ 45 分钟", setting: "微辣可以", extraction: null, excludedIds: [first[0].id], vetoReason: "太辣了" });
  assert.notEqual(second[0]?.id, first[0].id);
});
