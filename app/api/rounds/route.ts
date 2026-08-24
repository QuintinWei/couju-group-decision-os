import { GET as getCandidates } from "../candidates/route";
import { DEFAULT_INTERESTS, type Candidate } from "../../../lib/couju";
import { aggregateRoundFeedback, buildNextRoundSlots, canRequestPrivateDiscovery, RoundCompositionError } from "../../../lib/rounds";
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
  if (!canRequestPrivateDiscovery(candidateIds, member.choices)) {
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
  if (room.currentRound !== expectedRound) return error("房间已进入下一轮，请刷新后继续", 409);
  if (room.currentRound >= 3) return error("已经是第三轮，无法继续换一批", 429);
  if (room.members.length === 0 || room.members.some((member) => !member.submittedAt)) {
    return error("所有已加入成员提交本轮选择后，房主才能换一批", 409);
  }
  if (room.candidates.length !== 12 || !hasUniqueProviderIds(room.candidates)) {
    return error("本轮共享候选不完整，无法安全生成下一轮", 422);
  }

  const feedback = aggregateRoundFeedback(room.candidates, room.members);
  const nominations = validNominations(room.members);
  const excludedIds = new Set<string>([
    ...feedback.rejectedCandidateIds,
    ...room.roundHistory.flatMap((entry) => entry.feedback.rejectedCandidateIds),
  ]);
  const learnedCategories = [...feedback.categoryScores.entries()]
    .filter(([, score]) => score > 0)
    .sort((left, right) => right[1] - left[1])
    .map(([category]) => category)
    .slice(0, 6);
  const nominationIds = nominations.map((candidate) => candidate.source.providerId || candidate.id);
  const sharedExclude = [...new Set([...excludedIds, ...nominationIds])];
  const exploration = await fetchCandidateBatch(request, {
    city: room.config.city,
    kind: room.config.kind,
    strategy: "explore",
    exclude: sharedExclude,
    unseen: unseenCategories(room),
    seed: `explore:${room.code}:${room.currentRound}`,
  });
  const reservedExploration = exploration.candidates.slice(0, 4);
  const learned = await fetchCandidateBatch(request, {
    city: room.config.city,
    kind: room.config.kind,
    strategy: "learn",
    exclude: [...sharedExclude, ...reservedExploration.map((candidate) => candidate.source.providerId || candidate.id)],
    interests: learnedCategories,
    seed: `learn:${room.code}:${room.currentRound}`,
  });

  let candidates: Candidate[];
  try {
    candidates = buildNextRoundSlots(nominations, learned.candidates, reservedExploration);
  } catch (cause) {
    if (cause instanceof RoundCompositionError) return error(cause.message, 422);
    throw cause;
  }
  if (candidates.length !== 12 || !hasUniqueProviderIds(candidates)) return error("下一轮候选未能组成 12 张不同卡片", 422);

  const meta: CandidateMeta = {
    ...learned.meta,
    label: `${learned.meta.mode === "demo" ? "根据全体反馈 · 演示" : "根据全体反馈"}`,
    strategy: "learn",
    keywords: learnedCategories,
  };
  const result = await advanceStoredRound({ ...auth, expectedRound, candidates, meta, reason: refreshReason(room) });
  return mutationResponse(result);
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
  setting?: string;
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
  if (input.setting) url.searchParams.set("setting", input.setting);

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
    ...member.privateCandidates.map((candidate) => candidate.source.providerId || candidate.id),
    ...Object.entries(member.choices).filter(([, choice]) => choice === "no").map(([id]) => id),
  ]);
}

function unseenCategories(room: StoredRoom) {
  const seen = new Set([
    ...room.roundHistory.flatMap((entry) => entry.categories),
    ...room.candidates.map((candidate) => candidate.type),
  ]);
  return DEFAULT_INTERESTS[room.config.kind].filter((category) => !seen.has(category));
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
  const round = Number(value);
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
      : result.code === "STALE_ROUND" ? 409
        : 422;
  return error(mutationMessage(result.code), status);
}

function mutationMessage(code: RoundMutationFailure["code"]) {
  if (code === "UNAUTHORIZED") return "成员身份已失效，请重新加入";
  if (code === "NOT_CREATOR") return "只有房主可以发起下一轮";
  if (code === "MAX_ROUNDS") return "已经是第三轮，无法继续换一批";
  if (code === "STALE_ROUND") return "房间已更新，请刷新后继续";
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
