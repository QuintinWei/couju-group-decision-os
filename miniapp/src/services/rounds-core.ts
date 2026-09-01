import type { Choice, Membership, ParticipantRoom, RejectionReason } from "../types/api.ts";
import type { ParticipantRanking } from "../domain/result-action.ts";
import type { ApiRequestOptions } from "./request-core.ts";

type ApiRequest = <T>(path: string, options?: ApiRequestOptions) => Promise<T>;

type SubmissionRoom = Pick<ParticipantRoom, "currentRound"> & {
  candidates: Array<Pick<ParticipantRoom["candidates"][number], "id">>;
};

type SubmissionMember = Pick<ParticipantRoom["members"][number], "budgetLabel" | "commuteLabel" | "setting" | "note" | "extraction">;

export function createRoundsService({ request }: { request: ApiRequest }) {
  async function submitSharedRound(
    membership: Membership,
    room: SubmissionRoom,
    member: SubmissionMember,
    choices: Record<string, Choice>,
    rejectionReasons: Record<string, RejectionReason>,
  ) {
    return request<{ ok: true }>("/api/members", {
      method: "PATCH",
      membership,
      data: {
        expectedRound: room.currentRound,
        budgetLabel: member.budgetLabel,
        commuteLabel: member.commuteLabel,
        setting: member.setting,
        note: member.note,
        extraction: member.extraction,
        choices,
        rejectionReasons,
      },
    });
  }

  async function requestPrivateDiscovery(membership: Membership, expectedRound: number) {
    await request<{ ok: true }>("/api/rounds", {
      method: "POST",
      membership,
      data: { action: "request", expectedRound, requested: true },
    });
    const response = await request<{ ok: true; candidates?: ParticipantRoom["candidates"] }>("/api/rounds", {
      method: "POST",
      membership,
      data: { action: "private-discovery", expectedRound },
    });
    const candidates = response.candidates ?? [];
    if (candidates.length !== 3 || new Set(candidates.map((candidate) => candidate.source.providerId || candidate.id)).size !== 3) {
      throw new Error("私人发现未能返回三张不同候选，请稍后重试");
    }
    return candidates;
  }

  async function nominatePrivateCandidate(membership: Membership, expectedRound: number, candidateId: string | null) {
    return request<{ ok: true; currentRound: number }>("/api/rounds", {
      method: "POST",
      membership,
      data: { action: "nominate", expectedRound, candidateId },
    });
  }

  async function advanceRound(membership: Membership, expectedRound: number) {
    return request<{ ok: true; currentRound: number }>("/api/rounds", {
      method: "POST",
      membership,
      data: { action: "advance", expectedRound },
    });
  }

  async function loadRoundInsight(membership: Membership) {
    const response = await request<{ insight?: { mode: "deepseek" | "deterministic"; learned: string; conflict: string; nextRound: string } }>("/api/insights", {
      method: "POST",
      membership,
      data: {},
      timeout: 20_000,
    });
    return response.insight ?? null;
  }

  async function loadExplanation(membership: Membership, room: Pick<ParticipantRoom, "config" | "members">, rankings: ParticipantRanking[]) {
    const response = await request<{ explanation?: { headline: string; reasoning: string; tradeoff: string } | null; mode: "deepseek" | "deterministic" }>("/api/explain", {
      method: "POST",
      membership,
      timeout: 50_000,
      data: {
        city: room.config.city,
        kind: room.config.kind,
        members: room.members.map((member) => ({ budget: member.budgetLabel, commute: member.commuteLabel })),
        candidates: rankings.slice(0, 3).map((candidate) => ({
          name: candidate.name,
          groupFit: candidate.groupFit,
          minUtility: candidate.minUtility,
          meanUtility: candidate.meanUtility,
          geoMean: candidate.geoMean,
          evidence: candidate.evidence,
        })),
      },
    });
    return response.explanation ?? null;
  }

  return { submitSharedRound, requestPrivateDiscovery, nominatePrivateCandidate, advanceRound, loadRoundInsight, loadExplanation };
}
