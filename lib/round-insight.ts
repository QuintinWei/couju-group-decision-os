import type { DecisionKind } from "./couju.ts";

export type RoundInsightInput = {
  kind: DecisionKind;
  categoryScores: Record<string, number>;
  rejectionReasonCounts: Record<string, number>;
  conflictMessages: string[];
  nominationCount: number;
};

export type RoundInsight = {
  mode: "deepseek" | "deterministic";
  learned: string;
  conflict: string;
  nextRound: string;
};

export function buildDeterministicRoundInsight(input: RoundInsightInput): Omit<RoundInsight, "mode"> {
  const positive = Object.entries(input.categoryScores).filter(([, score]) => score > 0).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([category]) => category);
  const reasonLabels: Record<string, string> = { distance: "距离", price: "价格", category: input.kind === "dining" ? "菜系" : "活动类型", place: "具体地点", other: "其他原因", queue: "排队" };
  const dominantReason = Object.entries(input.rejectionReasonCounts).sort((a, b) => b[1] - a[1])[0]?.[0];
  const learned = positive.length
    ? `大家更接受${positive.join("、")}${dominantReason ? `，同时更在意${reasonLabels[dominantReason] || dominantReason}` : ""}。`
    : dominantReason ? `本轮没有形成明确类型偏好，大家更在意${reasonLabels[dominantReason] || dominantReason}。` : "本轮反馈较少，暂未形成稳定的共同偏好。";
  const conflict = input.conflictMessages[0] || "没有单一条件造成冲突，是多项选择边界共同缩小了交集。";
  const nextRound = input.nominationCount > 0
    ? `下一轮保留 ${input.nominationCount} 张成员提名，并根据本轮反馈调整其余候选。`
    : positive.length || dominantReason ? "下一轮会根据本轮反馈学习，同时保留新类型探索。" : "本轮反馈较少，下一轮将扩大新类型探索。";
  return { learned, conflict, nextRound };
}
