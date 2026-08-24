import { canRequestPrivateDiscovery } from "./rounds.ts";

type CandidateIdentity = { id: string; source?: { providerId?: string } };
type MemberSubmission = { id: string; submittedAt: string | null };
type PrivateDiscoveryMember = { privateCandidates: CandidateIdentity[]; nominatedCandidate: CandidateIdentity | null };

export type RoundGateCode = "NOT_CREATOR" | "STALE_ROUND" | "MAX_ROUNDS" | "INCOMPLETE_MEMBERS" | "INVALID_SHARED_CANDIDATES" | "PRIVATE_INELIGIBLE" | "GENERATION_FAILED" | "MALFORMED";
export type RoundGateResult = { ok: true } | { ok: false; status: 400 | 403 | 409 | 422 | 429; code: RoundGateCode };

export function validateRoundActionPayload(body: Record<string, unknown>): RoundGateResult {
  const action = body.action;
  const roomCode = cleanText(body.roomCode, 6).toUpperCase();
  const memberId = cleanText(body.memberId, 64);
  const token = cleanText(body.token, 128);
  const expectedRound = body.expectedRound;
  if (!(action === "request" || action === "private-discovery" || action === "nominate" || action === "advance") || !/^[A-Z0-9]{6}$/.test(roomCode) || !memberId || !token || typeof expectedRound !== "number" || !Number.isInteger(expectedRound) || expectedRound < 1 || expectedRound > 3) {
    return { ok: false, status: 400, code: "MALFORMED" };
  }
  if (action === "request" && body.requested !== undefined && typeof body.requested !== "boolean") return { ok: false, status: 400, code: "MALFORMED" };
  return { ok: true };
}

export function evaluateAdvanceGate(room: { currentRound: number; members: MemberSubmission[]; candidates: CandidateIdentity[] }, memberId: string, expectedRound: number): RoundGateResult {
  if (room.members[0]?.id !== memberId) return { ok: false, status: 403, code: "NOT_CREATOR" };
  if (room.currentRound !== expectedRound) return { ok: false, status: 409, code: "STALE_ROUND" };
  if (room.currentRound >= 3) return { ok: false, status: 429, code: "MAX_ROUNDS" };
  if (!allCurrentMembersSubmitted(room.members)) return { ok: false, status: 409, code: "INCOMPLETE_MEMBERS" };
  if (room.candidates.length !== 12 || !hasUniqueProviderIds(room.candidates)) return { ok: false, status: 422, code: "INVALID_SHARED_CANDIDATES" };
  return { ok: true };
}

export function evaluatePrivateDiscoveryGate(candidateIds: string[], choices: Record<string, "no" | "okay" | "like">): RoundGateResult {
  return canRequestPrivateDiscovery(candidateIds, choices)
    ? { ok: true }
    : { ok: false, status: 422, code: "PRIVATE_INELIGIBLE" };
}

export function allCurrentMembersSubmitted(members: MemberSubmission[]) {
  return members.length > 0 && members.every((member) => Boolean(member.submittedAt));
}

/** Private discoveries are only eligible for the shared pool when explicitly nominated. */
export function collectCurrentPrivateRejectedIds(members: PrivateDiscoveryMember[]) {
  return new Set(members.flatMap((member) => member.privateCandidates
    .filter((candidate) => candidate.id !== member.nominatedCandidate?.id)
    .map(providerKey)));
}

/** The next shared pool must never recycle a card the group already considered. */
export function collectAdvanceExcludedIds(input: {
  currentCandidates: CandidateIdentity[];
  historicalCandidateIds: Iterable<string>;
  historicalPrivateRejectedIds: Iterable<string>;
  feedbackRejectedIds: Iterable<string>;
  currentPrivateMembers: PrivateDiscoveryMember[];
}) {
  return new Set<string>([
    ...input.currentCandidates.map(providerKey),
    ...input.historicalCandidateIds,
    ...input.historicalPrivateRejectedIds,
    ...input.feedbackRejectedIds,
    ...collectCurrentPrivateRejectedIds(input.currentPrivateMembers),
  ]);
}

export async function executeGuardedGeneration<T, R>(gate: RoundGateResult, generate: () => Promise<T>, mutate: (generated: T) => Promise<R>): Promise<RoundGateResult | { ok: true; value: R }> {
  if (!gate.ok) return gate;
  try {
    const generated = await generate();
    return { ok: true, value: await mutate(generated) };
  } catch {
    return { ok: false, status: 422, code: "GENERATION_FAILED" };
  }
}

function hasUniqueProviderIds(candidates: CandidateIdentity[]) {
  const ids = candidates.map((candidate) => candidate.source?.providerId || candidate.id);
  return new Set(ids).size === ids.length;
}

function providerKey(candidate: CandidateIdentity) {
  return candidate.source?.providerId || candidate.id;
}

function cleanText(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().replace(/[<>]/g, "").slice(0, max) : "";
}
