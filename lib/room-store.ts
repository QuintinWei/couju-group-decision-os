import { getD1 } from "../db";
import type { Candidate, Choice, PreferenceExtraction, RoomConfig } from "./couju";
import { aggregatePrivateCategoryPenalties, aggregateRoundFeedback, type RoundFeedback } from "./rounds";
import { allCurrentMembersSubmitted } from "./round-api";
import { hasSubmittedMembersAtAdvanceBoundary } from "./round-store-guard";
import { validateMemberSubmission } from "./member-submission";
import { randomRoomCode } from "./room-code";
import { resolveGroupSchedule, type AvailabilityInterval, type ResolvedSchedule } from "./scheduling";

export type CandidateMeta = {
  mode: "live" | "demo";
  label: string;
  fetchedAt: string;
  disclaimer?: string;
  keywords?: string[];
  avoid?: string[];
  page?: number;
  center?: { lng: number; lat: number } | null;
  seed?: string;
  focused?: boolean;
  strategy?: "explore" | "focused" | "learn" | "private";
  commuteWindow?: string;
};

export type StoredMember = {
  id: string;
  name: string;
  origin: string;
  originLocation: { lng: number; lat: number } | null;
  budgetLabel: string;
  commuteLabel: string;
  setting: string;
  note: string;
  extraction: PreferenceExtraction | null;
  choices: Record<string, Choice>;
  submittedAt: string | null;
  availability: AvailabilityInterval[] | null;
  refreshRequestRound: number | null;
  privateCandidates: Candidate[];
  nominatedCandidate: Candidate | null;
};

export type RoundHistoryEntry = {
  round: number;
  candidateIds: string[];
  categories: string[];
  feedback: SerializedRoundFeedback;
  privateRejectedCandidateIds?: string[];
  privateCategoryPenalties?: Record<string, number>;
  reason: string;
  startedAt: string;
  endedAt: string;
};

export type SerializedRoundFeedback = Omit<RoundFeedback, "categoryScores"> & {
  categoryScores: Record<string, number>;
};

export type StoredRoom = {
  code: string;
  config: RoomConfig;
  candidates: Candidate[];
  meta: CandidateMeta;
  currentRound: number;
  roundHistory: RoundHistoryEntry[];
  members: StoredMember[];
  createdAt: string;
  updatedAt: string;
};

type RoomRow = {
  code: string;
  city: string;
  kind: string;
  date: string;
  schedule_config_json?: string | null;
  resolved_schedule_json?: string | null;
  target_people: number;
  candidates_json: string;
  candidate_meta_json: string;
  current_round?: number | null;
  round_history_json?: string | null;
  created_at: string;
  updated_at: string;
};

type MemberRow = {
  id: string;
  name: string;
  origin: string;
  origin_lng: number | null;
  origin_lat: number | null;
  budget_label: string | null;
  commute_label: string | null;
  setting: string | null;
  note: string | null;
  extraction_json: string | null;
  choices_json: string | null;
  submitted_at: string | null;
  availability_json?: string | null;
  refresh_request_round?: number | null;
  private_candidates_json?: string | null;
  nominated_candidate_json?: string | null;
};

export type MemberAuth = {
  roomCode: string;
  memberId: string;
  token: string;
};

export type RoundMutationFailure = {
  ok: false;
  code: "UNAUTHORIZED" | "STALE_ROUND" | "NOT_CREATOR" | "MAX_ROUNDS" | "INCOMPLETE_MEMBERS" | "INVALID_NOMINATION" | "INVALID_CANDIDATES";
};

export type RoundMutationResult =
  | { ok: true; currentRound: number }
  | RoundMutationFailure;

export async function createStoredRoom(input: {
  config: RoomConfig;
  candidates: Candidate[];
  meta: CandidateMeta;
  creatorName: string;
  creatorOrigin: string;
  creatorOriginLocation: { lng: number; lat: number } | null;
}) {
  if (input.candidates.length !== 12 || !hasUniqueProviderIds(input.candidates)) throw new Error("INVALID_CANDIDATES");
  const db = getD1();
  try { await purgeExpiredRooms(); }
  catch (cause) { console.warn("[rooms] retention purge skipped:", cause instanceof Error ? cause.message : "unknown error"); }
  const code = await createUniqueCode();
  const memberId = crypto.randomUUID();
  const memberToken = randomToken();
  const tokenHash = await hashToken(memberToken);
  const now = new Date().toISOString();

  await db.batch([
    db.prepare("INSERT INTO rooms (code, city, kind, date, schedule_config_json, resolved_schedule_json, target_people, candidates_json, candidate_meta_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(code, input.config.city, input.config.kind, input.config.dateRange.start, JSON.stringify({ dateRange: input.config.dateRange, preferredPeriods: input.config.preferredPeriods, durationMinutes: input.config.durationMinutes }), null, input.config.people, JSON.stringify(input.candidates), JSON.stringify(input.meta), now, now),
    db.prepare("INSERT INTO members (id, room_code, token_hash, name, origin, origin_lng, origin_lat, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(memberId, code, tokenHash, input.creatorName, input.creatorOrigin, input.creatorOriginLocation?.lng ?? null, input.creatorOriginLocation?.lat ?? null, now, now),
  ]);

  return { code, memberId, memberToken };
}

export async function getStoredRoom(code: string): Promise<StoredRoom | null> {
  const db = getD1();
  const room = await db.prepare("SELECT * FROM rooms WHERE code = ? LIMIT 1").bind(code).first<RoomRow>();
  if (!room) return null;
  const memberRows = await db.prepare("SELECT id, name, origin, origin_lng, origin_lat, budget_label, commute_label, setting, note, extraction_json, choices_json, submitted_at, availability_json, refresh_request_round, private_candidates_json, nominated_candidate_json FROM members WHERE room_code = ? ORDER BY created_at ASC").bind(code).all<MemberRow>();
  const scheduleConfig = safeJson<{ dateRange: RoomConfig["dateRange"]; preferredPeriods: RoomConfig["preferredPeriods"]; durationMinutes: RoomConfig["durationMinutes"] }>(room.schedule_config_json ?? null, { dateRange: { start: room.date, end: room.date }, preferredPeriods: ["evening"], durationMinutes: null });
  const resolvedSchedule = safeJson<ResolvedSchedule | null>(room.resolved_schedule_json ?? null, null);
  return {
    code: room.code,
    config: {
      city: room.city as RoomConfig["city"],
      kind: room.kind as RoomConfig["kind"],
      ...scheduleConfig,
      resolvedSchedule,
      date: resolvedSchedule?.startAt.slice(0, 10) || scheduleConfig.dateRange.start,
      startTime: resolvedSchedule?.startAt.slice(11, 16) || "",
      endTime: resolvedSchedule?.endAt.slice(11, 16) || "",
      people: room.target_people,
    },
    candidates: safeJson<Candidate[]>(room.candidates_json, []),
    meta: safeJson<CandidateMeta>(room.candidate_meta_json, { mode: "demo", label: "凑局演示候选库", fetchedAt: room.created_at }),
    currentRound: room.current_round ?? 1,
    roundHistory: safeJson<RoundHistoryEntry[]>(room.round_history_json ?? null, []),
    members: memberRows.results.map((member) => ({
      id: member.id,
      name: member.name,
      origin: member.origin,
      originLocation: member.origin_lng !== null && member.origin_lat !== null ? { lng: member.origin_lng, lat: member.origin_lat } : null,
      budgetLabel: member.budget_label || "不限",
      commuteLabel: member.commute_label || "不限",
      setting: member.setting || "都可以",
      note: member.note || "",
      extraction: safeJson<PreferenceExtraction | null>(member.extraction_json, null),
      choices: safeJson<Record<string, Choice>>(member.choices_json, {}),
      submittedAt: member.submitted_at,
      availability: safeJson<AvailabilityInterval[] | null>(member.availability_json ?? null, null),
      refreshRequestRound: member.refresh_request_round ?? null,
      privateCandidates: safeJson<Candidate[]>(member.private_candidates_json ?? null, []),
      nominatedCandidate: safeJson<Candidate | null>(member.nominated_candidate_json ?? null, null),
    })),
    createdAt: room.created_at,
    updatedAt: room.updated_at,
  };
}

export async function getAuthenticatedStoredRoom(input: MemberAuth): Promise<StoredRoom | null> {
  const member = await authenticateMember(input);
  if (!member) return null;
  return getStoredRoom(input.roomCode);
}

export async function joinStoredRoom(code: string, name: string, origin: string, originLocation: { lng: number; lat: number } | null) {
  const room = await getStoredRoom(code);
  if (!room) return null;
  if (room.members.length >= room.config.people) throw new Error("ROOM_FULL");
  const db = getD1();
  const id = crypto.randomUUID();
  const token = randomToken();
  const tokenHash = await hashToken(token);
  const now = new Date().toISOString();
  const inserted = await db.prepare("INSERT INTO members (id, room_code, token_hash, name, origin, origin_lng, origin_lat, created_at, updated_at) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM members WHERE room_code = ?) < (SELECT target_people FROM rooms WHERE code = ?)")
    .bind(id, code, tokenHash, name, origin, originLocation?.lng ?? null, originLocation?.lat ?? null, now, now, code, code).run();
  if ((inserted.meta.changes ?? 0) < 1) throw new Error("ROOM_FULL");
  await db.prepare("UPDATE rooms SET resolved_schedule_json = NULL, updated_at = ? WHERE code = ?").bind(now, code).run();
  return { id, token };
}

export async function updateStoredMember(input: {
  roomCode: string;
  memberId: string;
  token: string;
  budgetLabel: string;
  commuteLabel: string;
  setting: string;
  note: string;
  extraction: PreferenceExtraction | null;
  choices: Record<string, Choice>;
  expectedRound: number;
}): Promise<{ ok: true } | { ok: false; code: "UNAUTHORIZED" | "STALE_ROUND" | "INVALID_CHOICES" | "INVALID_SHARED_CANDIDATES" }> {
  const db = getD1();
  const member = await authenticateMember(input);
  if (!member) return { ok: false, code: "UNAUTHORIZED" };
  const room = await db.prepare("SELECT current_round, candidates_json FROM rooms WHERE code = ? LIMIT 1").bind(input.roomCode).first<{ current_round: number; candidates_json: string }>();
  if (!room || room.current_round !== input.expectedRound) return { ok: false, code: "STALE_ROUND" };
  const candidateIds = safeJson<Candidate[]>(room.candidates_json, []).map((candidate) => candidate.id);
  const validation = validateMemberSubmission({ expectedRound: input.expectedRound, currentRound: room.current_round, candidateIds, choices: input.choices });
  if (!validation.ok) return { ok: false, code: validation.code === "INVALID_SHARED_CANDIDATES" ? "INVALID_SHARED_CANDIDATES" : validation.code === "STALE_ROUND" ? "STALE_ROUND" : "INVALID_CHOICES" };
  const now = new Date().toISOString();
  const updated = await db.prepare("UPDATE members SET budget_label = ?, commute_label = ?, setting = ?, note = ?, extraction_json = ?, choices_json = ?, submitted_at = ?, updated_at = ? WHERE id = ? AND room_code = ? AND EXISTS (SELECT 1 FROM rooms WHERE code = ? AND current_round = ?)")
    .bind(input.budgetLabel, input.commuteLabel, input.setting, input.note, JSON.stringify(input.extraction), JSON.stringify(input.choices), now, now, input.memberId, input.roomCode, input.roomCode, input.expectedRound).run();
  if ((updated.meta.changes ?? 0) !== 1) return { ok: false, code: "STALE_ROUND" };
  await db.prepare("UPDATE rooms SET updated_at = ? WHERE code = ? AND current_round = ?").bind(now, input.roomCode, input.expectedRound).run();
  return { ok: true };
}

export async function updateStoredAvailability(input: MemberAuth & { expectedRound: number; intervals: AvailabilityInterval[] }) {
  const member = await authenticateMember(input);
  if (!member) return { ok: false as const, code: "UNAUTHORIZED" as const };
  const room = await getStoredRoom(input.roomCode);
  if (!room || room.currentRound !== input.expectedRound) return { ok: false as const, code: "STALE_ROUND" as const };
  const nextMembers = room.members.map((item) => ({ memberId: item.id, intervals: item.id === input.memberId ? input.intervals : item.availability }));
  let resolution;
  try { resolution = resolveGroupSchedule(room.config, nextMembers); }
  catch { return { ok: false as const, code: "INVALID_AVAILABILITY" as const }; }
  const resolved = resolution.status === "resolved" ? resolution.schedule : null;
  const now = new Date().toISOString();
  const results = await getD1().batch([
    getD1().prepare("UPDATE members SET availability_json = ?, updated_at = ? WHERE id = ? AND room_code = ? AND EXISTS (SELECT 1 FROM rooms WHERE code = ? AND current_round = ?)")
      .bind(JSON.stringify(input.intervals), now, input.memberId, input.roomCode, input.roomCode, input.expectedRound),
    getD1().prepare("UPDATE rooms SET resolved_schedule_json = ?, updated_at = ? WHERE code = ? AND current_round = ?")
      .bind(resolved ? JSON.stringify(resolved) : null, now, input.roomCode, input.expectedRound),
  ]);
  if ((results[0].meta.changes ?? 0) !== 1) return { ok: false as const, code: "STALE_ROUND" as const };
  return { ok: true as const, resolution };
}

export async function setRefreshRequest(input: MemberAuth & { requested: boolean; expectedRound: number }): Promise<RoundMutationResult> {
  const member = await authenticateMember(input);
  if (!member) return { ok: false, code: "UNAUTHORIZED" };
  const room = await readRoomRound(input.roomCode);
  if (!room || room.current_round !== input.expectedRound) return { ok: false, code: "STALE_ROUND" };

  const now = new Date().toISOString();
  const results = await getD1().batch([
    getD1().prepare("UPDATE members SET refresh_request_round = ?, updated_at = ? WHERE id = ? AND room_code = ? AND EXISTS (SELECT 1 FROM rooms WHERE code = ? AND current_round = ?)")
      .bind(input.requested ? input.expectedRound : null, now, input.memberId, input.roomCode, input.roomCode, input.expectedRound),
    getD1().prepare("UPDATE rooms SET updated_at = ? WHERE code = ? AND current_round = ?")
      .bind(now, input.roomCode, input.expectedRound),
  ]);
  if ((results[0].meta.changes ?? 0) !== 1) return { ok: false, code: "STALE_ROUND" };
  return { ok: true, currentRound: input.expectedRound };
}

export async function savePrivateCandidates(input: MemberAuth & { expectedRound: number; candidates: Candidate[] }): Promise<RoundMutationResult> {
  const member = await authenticateMember(input);
  if (!member) return { ok: false, code: "UNAUTHORIZED" };
  if (input.candidates.length !== 3 || !hasUniqueProviderIds(input.candidates)) return { ok: false, code: "INVALID_CANDIDATES" };
  const room = await readRoomRound(input.roomCode);
  if (!room || room.current_round !== input.expectedRound) return { ok: false, code: "STALE_ROUND" };

  const now = new Date().toISOString();
  const results = await getD1().batch([
    getD1().prepare("UPDATE members SET private_candidates_json = ?, nominated_candidate_json = NULL, updated_at = ? WHERE id = ? AND room_code = ? AND EXISTS (SELECT 1 FROM rooms WHERE code = ? AND current_round = ?)")
      .bind(JSON.stringify(input.candidates), now, input.memberId, input.roomCode, input.roomCode, input.expectedRound),
    getD1().prepare("UPDATE rooms SET updated_at = ? WHERE code = ? AND current_round = ?")
      .bind(now, input.roomCode, input.expectedRound),
  ]);
  if ((results[0].meta.changes ?? 0) !== 1) return { ok: false, code: "STALE_ROUND" };
  return { ok: true, currentRound: input.expectedRound };
}

export async function nominatePrivateCandidate(input: MemberAuth & { expectedRound: number; candidateId: string | null }): Promise<RoundMutationResult> {
  const member = await authenticateMember(input);
  if (!member) return { ok: false, code: "UNAUTHORIZED" };
  const room = await readRoomRound(input.roomCode);
  if (!room || room.current_round !== input.expectedRound) return { ok: false, code: "STALE_ROUND" };

  const privateCandidates = safeJson<Candidate[]>(member.private_candidates_json, []);
  const nominatedCandidate = input.candidateId === null
    ? null
    : privateCandidates.find((candidate) => candidate.id === input.candidateId) ?? null;
  if (input.candidateId !== null && !nominatedCandidate) return { ok: false, code: "INVALID_NOMINATION" };

  const now = new Date().toISOString();
  const results = await getD1().batch([
    getD1().prepare("UPDATE members SET nominated_candidate_json = ?, updated_at = ? WHERE id = ? AND room_code = ? AND EXISTS (SELECT 1 FROM rooms WHERE code = ? AND current_round = ?)")
      .bind(nominatedCandidate === null ? null : JSON.stringify(nominatedCandidate), now, input.memberId, input.roomCode, input.roomCode, input.expectedRound),
    getD1().prepare("UPDATE rooms SET updated_at = ? WHERE code = ? AND current_round = ?")
      .bind(now, input.roomCode, input.expectedRound),
  ]);
  if ((results[0].meta.changes ?? 0) !== 1) return { ok: false, code: "STALE_ROUND" };
  return { ok: true, currentRound: input.expectedRound };
}

export async function advanceStoredRound(input: MemberAuth & { expectedRound: number; candidates: Candidate[]; meta: CandidateMeta; reason: string }): Promise<RoundMutationResult> {
  const member = await authenticateMember(input);
  if (!member) return { ok: false, code: "UNAUTHORIZED" };
  if (input.candidates.length !== 12 || !hasUniqueProviderIds(input.candidates)) return { ok: false, code: "INVALID_CANDIDATES" };
  const db = getD1();
  const [creator, room] = await Promise.all([
    db.prepare("SELECT id FROM members WHERE room_code = ? ORDER BY created_at ASC LIMIT 1").bind(input.roomCode).first<{ id: string }>(),
    readRoomRound(input.roomCode),
  ]);
  if (!creator || creator.id !== input.memberId) return { ok: false, code: "NOT_CREATOR" };
  if (!room || room.current_round !== input.expectedRound) return { ok: false, code: "STALE_ROUND" };
  if (room.current_round >= 3) return { ok: false, code: "MAX_ROUNDS" };
  const roundMembers = await readRoundMembers(input.roomCode);
  if (!allCurrentMembersSubmitted(roundMembers)) return { ok: false, code: "INCOMPLETE_MEMBERS" };
  if (!await hasSubmittedMembersAtAdvanceBoundary(db, input.roomCode)) return { ok: false, code: "INCOMPLETE_MEMBERS" };

  const now = new Date().toISOString();
  const nextRound = room.current_round + 1;
  const currentCandidates = safeJson<Candidate[]>(room.candidates_json, []);
  const feedback = serializeRoundFeedback(aggregateRoundFeedback(
    currentCandidates,
    roundMembers,
  ));
  const history = safeJson<RoundHistoryEntry[]>(room.round_history_json, []);
  const nextHistory = [...history, {
    round: room.current_round,
    candidateIds: currentCandidates.map((candidate) => candidate.id),
    categories: [...new Set(currentCandidates.map((candidate) => candidate.matchedInterest || candidate.type))],
    feedback,
    privateRejectedCandidateIds: await readPrivateRejectedCandidateIds(input.roomCode),
    privateCategoryPenalties: Object.fromEntries(aggregatePrivateCategoryPenalties(roundMembers)),
    reason: input.reason,
    startedAt: history.at(-1)?.endedAt ?? room.created_at,
    endedAt: now,
  }];
  const candidatesJson = JSON.stringify(input.candidates);
  const metaJson = JSON.stringify(input.meta);
  const historyJson = JSON.stringify(nextHistory);

  const results = await db.batch([
    db.prepare("UPDATE rooms SET candidates_json = ?, candidate_meta_json = ?, current_round = ?, round_history_json = ?, updated_at = ? WHERE code = ? AND current_round = ? AND updated_at = ? AND (SELECT COUNT(*) FROM members WHERE room_code = ?) = (SELECT COUNT(*) FROM members WHERE room_code = ? AND submitted_at IS NOT NULL)")
      .bind(candidatesJson, metaJson, nextRound, historyJson, now, input.roomCode, input.expectedRound, room.updated_at, input.roomCode, input.roomCode),
    db.prepare("UPDATE members SET choices_json = NULL, submitted_at = NULL, refresh_request_round = NULL, private_candidates_json = NULL, nominated_candidate_json = NULL, updated_at = ? WHERE room_code = ? AND EXISTS (SELECT 1 FROM rooms WHERE code = ? AND current_round = ? AND round_history_json = ? AND updated_at = ?)")
      .bind(now, input.roomCode, input.roomCode, nextRound, historyJson, now),
  ]);
  if ((results[0].meta.changes ?? 0) !== 1) return { ok: false, code: "STALE_ROUND" };
  return { ok: true, currentRound: nextRound };
}

type AuthenticatedMemberRow = {
  token_hash: string;
  private_candidates_json: string | null;
};

type RoomRoundRow = Pick<RoomRow, "current_round" | "round_history_json" | "candidates_json" | "created_at" | "updated_at">;

async function authenticateMember(input: MemberAuth): Promise<AuthenticatedMemberRow | null> {
  const row = await getD1().prepare("SELECT token_hash, private_candidates_json FROM members WHERE id = ? AND room_code = ? LIMIT 1")
    .bind(input.memberId, input.roomCode).first<AuthenticatedMemberRow>();
  if (!row || !safeEqual(row.token_hash, await hashToken(input.token))) return null;
  return row;
}

/** Identity check for endpoints that only need to know the caller is a real member of the room. */
export async function authenticateMemberToken(input: MemberAuth): Promise<boolean> {
  return Boolean(await authenticateMember(input));
}

async function readRoomRound(roomCode: string): Promise<RoomRoundRow | null> {
  return getD1().prepare("SELECT current_round, round_history_json, candidates_json, created_at, updated_at FROM rooms WHERE code = ? LIMIT 1")
    .bind(roomCode).first<RoomRoundRow>();
}

async function readRoundMembers(roomCode: string) {
  const rows = await getD1().prepare("SELECT id, origin_lng, origin_lat, budget_label, commute_label, setting, extraction_json, choices_json, submitted_at FROM members WHERE room_code = ? ORDER BY created_at ASC")
    .bind(roomCode).all<Pick<MemberRow, "id" | "origin_lng" | "origin_lat" | "budget_label" | "commute_label" | "setting" | "extraction_json" | "choices_json" | "submitted_at">>();
  return rows.results.map((member) => ({
    id: member.id,
    originLocation: member.origin_lng !== null && member.origin_lat !== null ? { lng: member.origin_lng, lat: member.origin_lat } : null,
    budgetLabel: member.budget_label || "不限",
    commuteLabel: member.commute_label || "不限",
    setting: member.setting || "都可以",
    extraction: safeJson<PreferenceExtraction | null>(member.extraction_json, null),
    choices: safeJson<Record<string, Choice>>(member.choices_json, {}),
    submittedAt: member.submitted_at,
  }));
}

async function readPrivateRejectedCandidateIds(roomCode: string) {
  const rows = await getD1().prepare("SELECT private_candidates_json, nominated_candidate_json FROM members WHERE room_code = ?")
    .bind(roomCode).all<Pick<MemberRow, "private_candidates_json" | "nominated_candidate_json">>();
  return [...new Set(rows.results.flatMap((member) => {
    const nominated = safeJson<Candidate | null>(member.nominated_candidate_json, null);
    return safeJson<Candidate[]>(member.private_candidates_json, [])
      .filter((candidate) => candidate.id !== nominated?.id)
      .map((candidate) => candidate.source.providerId || candidate.id);
  }))];
}

function serializeRoundFeedback(feedback: RoundFeedback): SerializedRoundFeedback {
  return {
    ...feedback,
    categoryScores: Object.fromEntries(feedback.categoryScores),
  };
}

function hasUniqueProviderIds(candidates: Candidate[]): boolean {
  const ids = candidates.map((candidate) => candidate.source.providerId || candidate.id);
  return new Set(ids).size === ids.length;
}

async function createUniqueCode() {
  const db = getD1();
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = randomRoomCode();
    const existing = await db.prepare("SELECT 1 AS found FROM rooms WHERE code = ? LIMIT 1").bind(code).first();
    if (!existing) return code;
  }
  throw new Error("ROOM_CODE_EXHAUSTED");
}

export const ROOM_RETENTION_DAYS = 30;

/**
 * rooms 与 members 只增不减，且当前部署形态没有 wrangler cron 可以挂定时任务。
 * 建房时机会式清理一次过期房间，失败不影响建房本身。
 */
export async function purgeExpiredRooms(retentionDays = ROOM_RETENTION_DAYS, now = new Date()) {
  const cutoff = new Date(now.getTime() - retentionDays * 86_400_000).toISOString();
  const db = getD1();
  await db.batch([
    db.prepare("DELETE FROM members WHERE room_code IN (SELECT code FROM rooms WHERE updated_at < ?)").bind(cutoff),
    db.prepare("DELETE FROM rooms WHERE updated_at < ?").bind(cutoff),
  ]);
  return cutoff;
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (value) => value.toString(36).padStart(2, "0")).join("");
}

async function hashToken(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return diff === 0;
}

function safeJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}
