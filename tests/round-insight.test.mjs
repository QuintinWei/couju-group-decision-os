import assert from "node:assert/strict";
import test from "node:test";
import { buildDeterministicRoundInsight } from "../lib/round-insight.ts";

test("round insight explains the strongest learned preference and commute conflict", () => {
  const insight = buildDeterministicRoundInsight({
    kind: "dining",
    categoryScores: { 日料: 4, 火锅: -3, 烤肉: 1 },
    rejectionReasonCounts: { queue: 2, distance: 1 },
    conflictMessages: ["两位成员的通勤范围没有形成共同交集"],
    nominationCount: 2,
  });
  assert.match(insight.learned, /日料/);
  assert.match(insight.learned, /排队/);
  assert.match(insight.conflict, /通勤/);
  assert.match(insight.nextRound, /2 张成员提名/);
});

test("round insight stays honest when feedback has no positive category", () => {
  const insight = buildDeterministicRoundInsight({ kind: "activity", categoryScores: { 景点: -2 }, rejectionReasonCounts: {}, conflictMessages: [], nominationCount: 0 });
  assert.doesNotMatch(insight.learned, /更喜欢景点/);
  assert.match(insight.nextRound, /反馈较少/);
});
