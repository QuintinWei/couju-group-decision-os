import { GET as getCandidates } from "../candidates/route";
import { DEFAULT_INTERESTS, type Candidate } from "../../../lib/couju";
import { aggregatePrivateCategoryPenalties, aggregateRoundFeedback, applyCategoryPenalties, buildNextRoundSlots, normalizeFeedbackInterestScores, selectQualifiedExploration, RoundCompositionError } from "../../../lib/rounds";
import { collectAdvanceExcludedIds, evaluateAdvanceGate, evaluatePrivateDiscoveryGate, executeGuardedGeneration, validateRoundActionPayload } from "../../../lib/round-api";
import type { CandidateMeta, RoundMutationFailure, StoredMember, StoredRoom } from "../../../lib/room-store";

export const dynamic = "force-dynamic";

type RoundAction = "request" | "private-discovery" | "nominate" | "advance";
type RoundBody = Record<string, unknown>;

export async function POST(request: Request) {
  let body: RoundBody;
  try {
    body = await request.json() as RoundBody;
  } catch {
    return error("请求内容无效", 400);
  }

  const payloadValidation = validateRoundActionPayload(body);
  if (!payloadValidation.ok) return error("成员身份、轮次或请求参数无效", payloadValidation.status);

  const action = parseAction(body.action);
  const auth = parseMemberAuth(body);
  const expectedRound = parseRound(body.expectedRound);
  if (!action || !auth || expectedRound === null) return error("成员身份或轮次无效", 400);

  try {
    if (action === "request") return handleRequest(auth, expectedRound, body);
    if (action === "nominate") return handleNomination(auth, expectedRound, body);
    if (action === "private-discovery") return handlePrivateDiscovery(request, auth, expectedRound);
    return handleAdvance(request, auth, expectedRound);
  } catch (cause) {
    console.error("[rounds]", cause);
    return error("轮次服务暂时不可用", 503);
  }
}

async function handleRequest(auth: MemberAuth, expectedRound: number, body: RoundBody) {
  const requested = typeof body.requested === "boolean" ? body.requested : true;
  const { setRefreshRequest } = await loadRoomStore();
  const result = await setRefreshRequest({ ...auth, expectedRound, requested });
  return mutationResponse(result);
}

async function handleNomination(auth: MemberAuth, expectedRound: number, body: RoundBody) {
  const candidateId = body.candidateId === null ? null : cleanText(body.candidateId, 160);
  if (candidateId === "") return error("请选择私人发现中的候选，或明确跳过", 400);
  const { nominatePrivateCandidate } = await loadRoomStore();
  const result = await nominatePrivateCandidate({ ...auth, expectedRound, candidateId });
  return mutationResponse(result);
}

async function handlePrivateDiscovery(request: Request, auth: MemberAuth, expectedRound: number) {
  const { getAuthenticatedStoredRoom, savePrivateCandidates } = await loadRoomStore();
  const room = await getAuthenticatedStoredRoom(auth);
  if (!room) return error("成员身份已失效，请重新加入", 403);
  if (room.currentRound !== expectedRound) return error("房间已进入下一轮，请刷新后继续", 409);
  const member = room.members.find((item) => item.id === auth.memberId);
  if (!member) return error("成员身份已失效，请重新加入", 403);

  const candidateIds = room.candidates.map((candidate) => candidate.id);
  const privateGate = evaluatePrivateDiscoveryGate(candidateIds, member.choices);
  if (!privateGate.ok) {
    return error("只有拒绝本轮全部 12 张共享候选后，才能开启私人发现", 422);
  }
  if (member.privateCandidates.length === 3) {
    return Response.json({ ok: true, currentRound: room.currentRound, candidates: member.privateCandidates, reused: true }, { headers: noStore });
  }

  const excludedIds = collectExcludedIds(room, member);
  const unseenTypes = unseenCategories(room);
  const interests = interestsFromMember(room, member);
  const generated = await fetchCandidateBatch(request, {
    city: room.config.city,
    kind: room.config.kind,
    strategy: "private",
    limit: 3,
    exclude: excludedIds,
    unseen: unseenTypes,
    setting: member.setting,
    interests,
    location: member.originLocation,
    budget: member.budgetLabel,
    commute: member.commuteLabel,
    note: member.note,
    date: room.config.date,
    startTime: room.config.startTime,
    endTime: room.config.endTime,
    seed: `private:${room.code}:${member.id}:${room.currentRound}`,
  });
  if (generated.candidates.length !== 3 || !hasUniqueProviderIds(generated.candidates)) return error("私人发现未能生成三张不同候选，请稍后再试", 422);

  const result = await savePrivateCandidates({ ...auth, expectedRound, candidates: generated.candidates });
  const response = mutationResponse(result);
  if (!result.ok) return response;
  return Response.json({ ok: true, currentRound: result.currentRound, candidates: generated.candidates, meta: generated.meta }, { headers: noStore });
}

async function handleAdvance(request: Request, auth: MemberAuth, expectedRound: number) {
  const { advanceStoredRound, getAuthenticatedStoredRoom } = await loadRoomStore();
  const room = await getAuthenticatedStoredRoom(auth);
  if (!room) return error("成员身份已失效，请重新加入", 403);
  const advanceGate = evaluateAdvanceGate(room, auth.memberId, expectedRound);
  if (!advanceGate.ok) return advanceGateResponse(advanceGate.code, advanceGate.status);

  const execution = await executeGuardedGeneration(
    advanceGate,
    () => generateNextRound(request, room),
    ({ candidates, meta }) => advanceStoredRound({ ...auth, expectedRound, candidates, meta, reason: refreshReason(room) }),
    (cause) => console.error("[rounds] advance storage failed:", cause instanceof Error ? cause.message : "unknown error"),
  );
  if (!execution.ok) {
    return execution.code === "GENERATION_FAILED"
      ? error("下一轮候选生成失败，当前轮次没有改变", execution.status)
      : execution.code === "SERVICE_FAILED"
        ? error("房间数据暂时无法更新，请稍后再试", execution.status)
      : advanceGateResponse(execution.code, execution.status);
  }
  return mutationResponse(execution.value);
}

type NextRoundPlan = { candidates: Candidate[]; meta: CandidateMeta };

async function generateNextRound(request: Request, room: StoredRoom): Promise<NextRoundPlan> {
  const feedback = aggregateRoundFeedback(room.candidates, room.members);
  const nominations = validNominations(room.members);
  const excludedIds = collectAdvanceExcludedIds({
    currentCandidates: room.candidates,
    historicalCandidateIds: room.roundHistory.flatMap((entry) => entry.candidateIds),
    historicalPrivateRejectedIds: room.roundHistory.flatMap((entry) => entry.privateRejectedCandidateIds ?? []),
    feedbackRejectedIds: [...feedback.rejectedCandidateIds, ...room.roundHistory.flatMap((entry) => entry.feedback.rejectedCandidateIds)],
    currentPrivateMembers: room.members,
  });
  const learnedScores = aggregateInterestScores(room, feedback);
  const learnedInterests = [...learnedScores.entries()]
    .filter(([, score]) => score > 0)
    .sort((left, right) => right[1] - left[1])
    .map(([category]) => category)
    .slice(0, 6);
  const exploreInterests = explorationInterests(room);
  if (exploreInterests.length < 4) throw new CandidateGenerationError("没有足够的未探索类别组成四张探索卡");
  const nominationIds = nominations.map((candidate) => candidate.source.providerId || candidate.id);
  const sharedExclude = [...new Set([...excludedIds, ...nominationIds])];
  const exploration = await fetchCandidateBatch(request, {
    city: room.config.city,
    kind: room.config.kind,
    strategy: "explore",
    exclude: sharedExclude,
    explore: exploreInterests,
    seed: `explore:${room.code}:${room.currentRound}`,
  });
  const reservedExploration = selectQualifiedExploration(exploration.candidates, exploreInterests, seenCategories(room));
  const learned = await fetchCandidateBatch(request, {
    city: room.config.city,
    kind: room.config.kind,
    strategy: "learn",
    exclude: [...sharedExclude, ...reservedExploration.map((candidate) => candidate.source.providerId || candidate.id)],
    interests: learnedInterests,
    scores: learnedScores,
    seed: `learn:${room.code}:${room.currentRound}`,
  });

  let candidates: Candidate[];
  try {
    candidates = buildNextRoundSlots(nominations, learned.candidates, reservedExploration);
  } catch (cause) {
    if (cause instanceof RoundCompositionError) throw new CandidateGenerationError(cause.message);
    throw cause;
  }
  if (candidates.length !== 12 || !hasUniqueProviderIds(candidates)) {
    throw new CandidateGenerationError("下一轮候选未能组成 12 张不同卡片");
  }

  const meta: CandidateMeta = {
    ...learned.meta,
    label: `${learned.meta.mode === "demo" ? "根据全体反馈 · 演示" : "根据全体反馈"}`,
    strategy: "learn",
    keywords: learnedInterests,
    commuteWindow: "沿用逐成员通勤上限",
    groupIntersection: true,
  };
  return { candidates, meta };
}

type MemberAuth = { roomCode: string; memberId: string; token: string };
type CandidateBatch = { candidates: Candidate[]; meta: CandidateMeta };
type CandidateRequest = {
  city: StoredRoom["config"]["city"];
  kind: StoredRoom["config"]["kind"];
  strategy: "explore" | "learn" | "private";
  limit?: number;
  exclude?: Iterable<string>;
  unseen?: Iterable<string>;
  interests?: string[];
  scores?: Map<string, number>;
  explore?: Iterable<string>;
  setting?: string;
  location?: { lng: number; lat: number } | null;
  budget?: string;
  commute?: string;
  note?: string;
  date?: string;
  startTime?: string;
  endTime?: string;
  seed: string;
};

async function fetchCandidateBatch(request: Request, input: CandidateRequest): Promise<CandidateBatch> {
  const url = new URL("/api/candidates", request.url);
  url.searchParams.set("city", input.city);
  url.searchParams.set("kind", input.kind);
  url.searchParams.set("strategy", input.strategy);
  url.searchParams.set("seed", input.seed);
  if (input.limit) url.searchParams.set("limit", String(input.limit));
  const exclude = [...(input.exclude ?? [])].filter(Boolean);
  const unseen = [...(input.unseen ?? [])].filter(Boolean);
  if (exclude.length) url.searchParams.set("exclude", exclude.join(","));
  if (unseen.length) url.searchParams.set("unseen", unseen.join(","));
  if (input.interests?.length) url.searchParams.set("interests", input.interests.join(","));
  if (input.scores?.size) url.searchParams.set("scores", [...input.scores.entries()].map(([category, score]) => `${category}:${score}`).join(","));
  if (input.explore) {
    const explore = [...input.explore].filter(Boolean);
    if (explore.length) url.searchParams.set("explore", explore.join(","));
  }
  if (input.setting) url.searchParams.set("setting", input.setting);
  if (input.location) url.searchParams.set("location", `${input.location.lng},${input.location.lat}`);
  if (input.budget) url.searchParams.set("budget", input.budget);
  if (input.commute) url.searchParams.set("commute", input.commute);
  if (input.note) url.searchParams.set("note", input.note);
  if (input.date) url.searchParams.set("date", input.date);
  if (input.startTime) url.searchParams.set("startTime", input.startTime);
  if (input.endTime) url.searchParams.set("endTime", input.endTime);

  const response = await getCandidates(new Request(url));
  if (!response.ok) throw new CandidateGenerationError(`候选生成失败（${response.status}）`);
  const payload = await response.json() as Partial<CandidateBatch>;
  if (!Array.isArray(payload.candidates) || !payload.meta || !isCandidateMeta(payload.meta)) {
    throw new CandidateGenerationError("候选生成返回了无效数据");
  }
  return { candidates: payload.candidates, meta: payload.meta };
}

function collectExcludedIds(room: StoredRoom, member: StoredMember) {
  return new Set([
    ...room.candidates.map((candidate) => candidate.source.providerId || candidate.id),
    ...room.roundHistory.flatMap((entry) => entry.candidateIds),
    ...room.roundHistory.flatMap((entry) => entry.privateRejectedCandidateIds ?? []),
    ...member.privateCandidates.map((candidate) => candidate.source.providerId || candidate.id),
    ...Object.entries(member.choices).filter(([, choice]) => choice === "no").map(([id]) => id),
  ]);
}

function unseenCategories(room: StoredRoom) {
  const seen = new Set([
    ...room.roundHistory.flatMap((entry) => entry.categories.map((category) => normalizeCategory(room.config.kind, category)).filter((category): category is string => Boolean(category))),
    ...room.candidates.map((candidate) => candidateCategory(room.config.kind, candidate)).filter((category): category is string => Boolean(category)),
  ]);
  return DEFAULT_INTERESTS[room.config.kind].filter((category) => !seen.has(category));
}

function aggregateInterestScores(room: StoredRoom, feedback: ReturnType<typeof aggregateRoundFeedback>) {
  let scores = normalizeFeedbackInterestScores(room.config.kind, feedback.categoryScores);
  scores = applyCategoryPenalties(scores, normalizeFeedbackInterestScores(room.config.kind, aggregatePrivateCategoryPenalties(room.members)));
  for (const entry of room.roundHistory) {
    scores = applyCategoryPenalties(scores, normalizeFeedbackInterestScores(room.config.kind, new Map(Object.entries(entry.feedback.categoryScores))));
    scores = applyCategoryPenalties(scores, normalizeFeedbackInterestScores(room.config.kind, new Map(Object.entries(entry.privateCategoryPenalties ?? {}))));
  }
  return scores;
}

function explorationInterests(room: StoredRoom) {
  return unseenCategories(room);
}

function seenCategories(room: StoredRoom) {
  return new Set([
    ...room.roundHistory.flatMap((entry) => entry.categories.map((category) => normalizeCategory(room.config.kind, category)).filter((category): category is string => Boolean(category))),
    ...room.candidates.map((candidate) => candidateCategory(room.config.kind, candidate)).filter((category): category is string => Boolean(category)),
  ]);
}

function candidateCategory(kind: StoredRoom["config"]["kind"], candidate: Candidate) {
  return candidate.matchedInterest && DEFAULT_INTERESTS[kind].includes(candidate.matchedInterest as never)
    ? candidate.matchedInterest
    : normalizeCategory(kind, candidate.type);
}

function normalizeCategory(kind: StoredRoom["config"]["kind"], value: string) {
  return DEFAULT_INTERESTS[kind].find((category) => category === value || value.includes(category) || category.includes(value)) ?? null;
}

function interestsFromMember(room: StoredRoom, member: StoredMember) {
  const text = `${member.note} ${member.setting}`;
  return DEFAULT_INTERESTS[room.config.kind].filter((category) => text.includes(category)).slice(0, 6);
}

function validNominations(members: StoredMember[]) {
  const used = new Set<string>();
  const nominations: Candidate[] = [];
  for (const member of members) {
    const candidate = member.nominatedCandidate;
    if (!candidate || !member.privateCandidates.some((item) => item.id === candidate.id)) continue;
    const key = candidate.source.providerId || candidate.id;
    if (used.has(key)) continue;
    used.add(key);
    nominations.push(candidate);
  }
  return nominations;
}

function refreshReason(room: StoredRoom) {
  const requests = room.members.filter((member) => member.refreshRequestRound === room.currentRound).length;
  return requests > 0 ? `${requests} 位成员请求换一批` : "房主在全员提交后发起下一轮";
}

function parseAction(value: unknown): RoundAction | null {
  return value === "request" || value === "private-discovery" || value === "nominate" || value === "advance" ? value : null;
}

function parseMemberAuth(body: RoundBody): MemberAuth | null {
  const roomCode = cleanText(body.roomCode, 6).toUpperCase();
  const memberId = cleanText(body.memberId, 64);
  const token = cleanText(body.token, 128);
  return /^[A-Z0-9]{6}$/.test(roomCode) && memberId && token ? { roomCode, memberId, token } : null;
}

function parseRound(value: unknown) {
  if (typeof value !== "number") return null;
  const round = value;
  return Number.isInteger(round) && round >= 1 && round <= 3 ? round : null;
}

function cleanText(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().replace(/[<>]/g, "").slice(0, max) : "";
}

function hasUniqueProviderIds(candidates: Candidate[]) {
  const ids = candidates.map((candidate) => candidate.source.providerId || candidate.id);
  return new Set(ids).size === ids.length;
}

function isCandidateMeta(value: unknown): value is CandidateMeta {
  if (!value || typeof value !== "object") return false;
  const meta = value as Record<string, unknown>;
  return (meta.mode === "live" || meta.mode === "demo") && typeof meta.label === "string" && typeof meta.fetchedAt === "string";
}

function mutationResponse(result: { ok: true; currentRound: number } | RoundMutationFailure) {
  if (result.ok) return Response.json({ ok: true, currentRound: result.currentRound }, { headers: noStore });
  const status = result.code === "UNAUTHORIZED" || result.code === "NOT_CREATOR" ? 403
    : result.code === "MAX_ROUNDS" ? 429
      : result.code === "STALE_ROUND" || result.code === "INCOMPLETE_MEMBERS" ? 409
        : 422;
  return error(mutationMessage(result.code), status);
}

function mutationMessage(code: RoundMutationFailure["code"]) {
  if (code === "UNAUTHORIZED") return "成员身份已失效，请重新加入";
  if (code === "NOT_CREATOR") return "只有房主可以发起下一轮";
  if (code === "MAX_ROUNDS") return "已经是第三轮，无法继续换一批";
  if (code === "STALE_ROUND") return "房间已更新，请刷新后继续";
  if (code === "INCOMPLETE_MEMBERS") return "所有已加入成员提交本轮选择后，房主才能换一批";
  if (code === "INVALID_NOMINATION") return "只能提名自己的私人发现卡";
  return "候选数据无效，无法更新轮次";
}

function error(message: string, status: number) {
  return Response.json({ error: message }, { status, headers: noStore });
}

class CandidateGenerationError extends Error {}

const noStore = { "Cache-Control": "no-store" };

async function loadRoomStore() {
  return import("../../../lib/room-store");
}

function advanceGateResponse(code: string, status: number) {
  if (code === "NOT_CREATOR") return error("只有房主可以发起下一轮", status);
  if (code === "STALE_ROUND") return error("房间已进入下一轮，请刷新后继续", status);
  if (code === "MAX_ROUNDS") return error("已经是第三轮，无法继续换一批", status);
  if (code === "INCOMPLETE_MEMBERS") return error("所有已加入成员提交本轮选择后，房主才能换一批", status);
  return error("本轮共享候选不完整，无法安全生成下一轮", status);
}
