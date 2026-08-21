import { getD1 } from "../db";
import type { Candidate, Choice, PreferenceExtraction, RoomConfig } from "./couju";

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
  strategy?: "explore" | "focused" | "learn";
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
};

export type StoredRoom = {
  code: string;
  config: RoomConfig;
  candidates: Candidate[];
  meta: CandidateMeta;
  members: StoredMember[];
  createdAt: string;
  updatedAt: string;
};

type RoomRow = {
  code: string;
  city: string;
  kind: string;
  date: string;
  start_time: string;
  end_time: string;
  target_people: number;
  candidates_json: string;
  candidate_meta_json: string;
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
};

export async function createStoredRoom(input: {
  config: RoomConfig;
  candidates: Candidate[];
  meta: CandidateMeta;
  creatorName: string;
  creatorOrigin: string;
  creatorOriginLocation: { lng: number; lat: number } | null;
}) {
  const db = getD1();
  const code = await createUniqueCode();
  const memberId = crypto.randomUUID();
  const memberToken = randomToken();
  const tokenHash = await hashToken(memberToken);
  const now = new Date().toISOString();

  await db.batch([
    db.prepare("INSERT INTO rooms (code, city, kind, date, start_time, end_time, target_people, candidates_json, candidate_meta_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(code, input.config.city, input.config.kind, input.config.date, input.config.startTime, input.config.endTime, input.config.people, JSON.stringify(input.candidates), JSON.stringify(input.meta), now, now),
    db.prepare("INSERT INTO members (id, room_code, token_hash, name, origin, origin_lng, origin_lat, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(memberId, code, tokenHash, input.creatorName, input.creatorOrigin, input.creatorOriginLocation?.lng ?? null, input.creatorOriginLocation?.lat ?? null, now, now),
  ]);

  return { code, memberId, memberToken };
}

export async function getStoredRoom(code: string): Promise<StoredRoom | null> {
  const db = getD1();
  const room = await db.prepare("SELECT * FROM rooms WHERE code = ? LIMIT 1").bind(code).first<RoomRow>();
  if (!room) return null;
  const memberRows = await db.prepare("SELECT id, name, origin, origin_lng, origin_lat, budget_label, commute_label, setting, note, extraction_json, choices_json, submitted_at FROM members WHERE room_code = ? ORDER BY created_at ASC").bind(code).all<MemberRow>();
  return {
    code: room.code,
    config: {
      city: room.city as RoomConfig["city"],
      kind: room.kind as RoomConfig["kind"],
      date: room.date,
      startTime: room.start_time,
      endTime: room.end_time,
      people: room.target_people,
    },
    candidates: safeJson<Candidate[]>(room.candidates_json, []),
    meta: safeJson<CandidateMeta>(room.candidate_meta_json, { mode: "demo", label: "凑局演示候选库", fetchedAt: room.created_at }),
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
    })),
    createdAt: room.created_at,
    updatedAt: room.updated_at,
  };
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
}) {
  const db = getD1();
  const row = await db.prepare("SELECT token_hash FROM members WHERE id = ? AND room_code = ? LIMIT 1").bind(input.memberId, input.roomCode).first<{ token_hash: string }>();
  if (!row || !safeEqual(row.token_hash, await hashToken(input.token))) return false;
  const now = new Date().toISOString();
  await db.prepare("UPDATE members SET budget_label = ?, commute_label = ?, setting = ?, note = ?, extraction_json = ?, choices_json = ?, submitted_at = ?, updated_at = ? WHERE id = ? AND room_code = ?")
    .bind(input.budgetLabel, input.commuteLabel, input.setting, input.note, JSON.stringify(input.extraction), JSON.stringify(input.choices), now, now, input.memberId, input.roomCode).run();
  await db.prepare("UPDATE rooms SET updated_at = ? WHERE code = ?").bind(now, input.roomCode).run();
  return true;
}

export async function replaceRoomCandidates(input: { roomCode: string; memberId: string; token: string; candidates: Candidate[]; meta: CandidateMeta }) {
  const db = getD1();
  const creator = await db.prepare("SELECT id, token_hash FROM members WHERE room_code = ? ORDER BY created_at ASC LIMIT 1").bind(input.roomCode).first<{ id: string; token_hash: string }>();
  if (!creator || creator.id !== input.memberId || !safeEqual(creator.token_hash, await hashToken(input.token))) return false;
  const now = new Date().toISOString();
  await db.batch([
    db.prepare("UPDATE rooms SET candidates_json = ?, candidate_meta_json = ?, updated_at = ? WHERE code = ?")
      .bind(JSON.stringify(input.candidates.slice(0, 16)), JSON.stringify(input.meta), now, input.roomCode),
    db.prepare("UPDATE members SET choices_json = NULL, submitted_at = NULL, updated_at = ? WHERE room_code = ?")
      .bind(now, input.roomCode),
  ]);
  return true;
}

async function createUniqueCode() {
  const db = getD1();
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = randomToken().replace(/[^A-Z0-9]/g, "").slice(0, 6).toUpperCase();
    if (code.length < 6) continue;
    const existing = await db.prepare("SELECT 1 AS found FROM rooms WHERE code = ? LIMIT 1").bind(code).first();
    if (!existing) return code;
  }
  throw new Error("ROOM_CODE_EXHAUSTED");
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
