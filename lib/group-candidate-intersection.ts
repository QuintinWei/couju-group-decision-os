import { estimateTravelBetween, parseCommuteLimit, type Candidate } from "./couju.ts";

type MemberReachability = {
  originLocation: { lng: number; lat: number } | null;
  commuteLabel: string;
};

export function selectGroupReachableCandidates(candidates: Candidate[], members: MemberReachability[], limit = 12) {
  return candidates
    .map((candidate) => {
      const ratios = members.map((member) => {
        const ceiling = parseCommuteLimit(member.commuteLabel);
        const travel = estimateTravelBetween(member.originLocation, candidate.location);
        if (ceiling === null) return travel === null ? Number.POSITIVE_INFINITY : travel / 90;
        return travel === null ? Number.POSITIVE_INFINITY : travel / ceiling;
      });
      return { candidate, worstRatio: Math.max(0, ...ratios), meanRatio: ratios.reduce((sum, value) => sum + value, 0) / Math.max(1, ratios.length) };
    })
    .filter((item) => item.worstRatio <= 1)
    .sort((a, b) => a.worstRatio - b.worstRatio || a.meanRatio - b.meanRatio || (b.candidate.rating ?? 0) - (a.candidate.rating ?? 0))
    .slice(0, limit)
    .map((item) => item.candidate);
}
