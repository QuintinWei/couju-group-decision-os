/**
 * Shared guards for the two endpoints that spend a server-side DeepSeek key.
 * Kept free of any Cloudflare binding import so the routes can stay testable in Node.
 */

export type AiEndpointCaller = { roomCode: string; memberId: string; token: string };

/** AI endpoints require a real room member before any paid call is made. */
export function parseAiEndpointCaller(body: Record<string, unknown>): AiEndpointCaller | null {
  const roomCode = cleanText(body.roomCode, 6).toUpperCase();
  const memberId = cleanText(body.memberId, 64);
  const token = cleanText(body.token, 128);
  return /^[A-Z0-9]{6}$/.test(roomCode) && memberId && token ? { roomCode, memberId, token } : null;
}

export type ExplainCandidateInput = {
  name: string;
  groupFit: number;
  minUtility: number;
  meanUtility: number;
  geoMean: number;
  evidence: string[];
};

export type ExplainMemberInput = { budget: string; commute: string };

const MAX_NAME_LENGTH = 40;
const MAX_EVIDENCE_ITEMS = 4;
const MAX_EVIDENCE_LENGTH = 60;
const MAX_LABEL_LENGTH = 24;

/**
 * Only these fields reach the prompt. Unbounded caller JSON used to be stringified straight
 * into the request, so a single call could inflate the DeepSeek input without limit. Member
 * names and origins are dropped entirely: the documented system prompt forbids naming people,
 * so that data has no reason to leave the server.
 */
export function sanitizeExplainPayload(input: { candidates: unknown; members: unknown }) {
  return {
    candidates: asArray(input.candidates).slice(0, 3).flatMap(sanitizeCandidate),
    members: asArray(input.members).slice(0, 6).map(sanitizeMember),
  };
}

function sanitizeCandidate(value: unknown): ExplainCandidateInput[] {
  if (!value || typeof value !== "object") return [];
  const item = value as Record<string, unknown>;
  const name = cleanText(item.name, MAX_NAME_LENGTH);
  if (!name) return [];
  return [{
    name,
    groupFit: score(item.groupFit),
    minUtility: score(item.minUtility),
    meanUtility: score(item.meanUtility),
    geoMean: score(item.geoMean),
    evidence: asArray(item.evidence)
      .slice(0, MAX_EVIDENCE_ITEMS)
      .map((entry) => cleanText(entry, MAX_EVIDENCE_LENGTH))
      .filter(Boolean),
  }];
}

function sanitizeMember(value: unknown): ExplainMemberInput {
  const item = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    budget: cleanText(item.budget, MAX_LABEL_LENGTH) || "不限",
    commute: cleanText(item.commute, MAX_LABEL_LENGTH) || "不限",
  };
}

function score(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? Math.min(100, Math.max(0, Math.round(parsed))) : 0;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function cleanText(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().replace(/[<>]/g, "").slice(0, max) : "";
}
