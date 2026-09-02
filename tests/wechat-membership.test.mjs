import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { toParticipantRoom } from "../lib/public-room.ts";

async function createMembershipDatabase({ includeForwardMigration = true } = {}) {
  const migrations = await Promise.all([
    readFile(new URL("../drizzle/0007_add_wechat_users.sql", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0008_add_unique_room_user_membership.sql", import.meta.url), "utf8"),
  ]);
  const db = new DatabaseSync(":memory:");
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE rooms (code text PRIMARY KEY, target_people integer NOT NULL);
    CREATE TABLE members (
      id text PRIMARY KEY,
      room_code text NOT NULL REFERENCES rooms(code),
      token_hash text NOT NULL,
      name text NOT NULL,
      origin text NOT NULL,
      origin_lng real,
      origin_lat real,
      created_at text NOT NULL,
      updated_at text NOT NULL
    );
  `);
  db.exec(migrations[0]);
  if (includeForwardMigration) db.exec(migrations[1]);
  db.prepare("INSERT INTO users (id, openid, nickname, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
    .run("user-a", "openid-a", "用户 A", "now", "now");
  db.prepare("INSERT INTO rooms (code, target_people) VALUES (?, ?)").run("ABC123", 6);
  db.prepare("INSERT INTO rooms (code, target_people) VALUES (?, ?)").run("XYZ789", 6);
  return db;
}

function asD1Database(db) {
  return {
    prepare(query) {
      return {
        bind(...values) {
          const statement = db.prepare(query);
          return {
            async first() { return statement.get(...values) ?? null; },
            async run() { return { meta: { changes: Number(statement.run(...values).changes) } }; },
          };
        },
      };
    },
  };
}

test("miniapp membership binds users while H5 remains anonymous-compatible", async () => {
  const [store, memberLinks, rooms, members] = await Promise.all([
    readFile(new URL("../lib/room-store.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/member-link-store.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/rooms/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/members/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(store, /userId\?: string \| null/);
  assert.match(store, /restoreStoredMembership/);
  assert.match(memberLinks, /UPDATE members SET token_hash = \?/);
  assert.match(rooms, /authenticateRequestUser/);
  assert.match(rooms, /currentUser\?\.nickname \|\| creatorName/);
  assert.match(members, /export async function GET/);
  assert.match(members, /currentUser\?\.nickname \|\| name/);
});

test("participant room DTOs redact persistent user ids from every member", () => {
  const member = (id, userId) => ({
    id,
    userId,
    name: id,
    origin: "静安寺",
    originLocation: { lng: 121.45, lat: 31.23 },
    budgetLabel: "不限",
    commuteLabel: "不限",
    constraintsReady: true,
    setting: "都可以",
    note: "",
    extraction: null,
    choices: {},
    rejectionReasons: {},
    submittedAt: null,
    availability: null,
    refreshRequestRound: null,
    privateCandidates: [],
    nominatedCandidate: null,
  });
  const room = {
    code: "ABC123",
    config: {
      city: "上海",
      kind: "dining",
      dateRange: { start: "2026-09-01", end: "2026-09-01" },
      preferredPeriods: ["evening"],
      durationMinutes: 120,
      resolvedSchedule: null,
      date: "2026-09-01",
      startTime: "",
      endTime: "",
      people: 2,
    },
    candidates: [],
    meta: { mode: "demo", label: "测试", fetchedAt: "2026-09-01T00:00:00.000Z" },
    currentRound: 1,
    roundHistory: [],
    members: [member("member-a", "user-a"), member("member-b", "user-b")],
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
  };

  const dto = toParticipantRoom(room, "member-a");

  assert.equal(dto.members.length, 2);
  assert.ok(dto.members.every((item) => !Object.hasOwn(item, "userId")));
  assert.equal(dto.members[0].origin, "静安寺");
  assert.deepEqual(dto.members[1], {
    id: "member-b",
    name: "member-b",
    locationReady: true,
    availabilitySubmitted: false,
    constraintsReady: true,
    submittedAt: null,
    refreshRequestRound: null,
    privateDiscoveryCompleted: false,
  });
  assert.doesNotMatch(JSON.stringify(dto.members[1]), /origin|budget|commute|setting|note|extraction|choices|availability"|privateCandidates/i);
});

test("the existing WeChat migration leaves room membership uniqueness to a forward migration", async () => {
  const db = await createMembershipDatabase({ includeForwardMigration: false });
  try {
    const insert = db.prepare("INSERT INTO members (id, room_code, user_id, token_hash, name, origin, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");

    insert.run("linked-before-forward-a", "ABC123", "user-a", "hash-a", "用户 A", "静安寺", "now", "now");
    assert.doesNotThrow(() => insert.run("linked-before-forward-b", "ABC123", "user-a", "hash-b", "用户 A", "静安寺", "now", "now"));
  } finally {
    db.close();
  }
});

test("membership migration enforces one linked user per room while allowing anonymous members", async () => {
  const db = await createMembershipDatabase();
  try {
    const index = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?").get("members_room_user_id_unique");
    assert.equal(index.name, "members_room_user_id_unique");
    const insert = db.prepare("INSERT INTO members (id, room_code, user_id, token_hash, name, origin, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");

    insert.run("linked-a", "ABC123", "user-a", "hash-a", "用户 A", "静安寺", "now", "now");
    assert.throws(
      () => insert.run("linked-b", "ABC123", "user-a", "hash-b", "用户 A", "静安寺", "now", "now"),
      /UNIQUE constraint failed/,
    );
    assert.doesNotThrow(() => insert.run("linked-other-room", "XYZ789", "user-a", "hash-c", "用户 A", "静安寺", "now", "now"));
    assert.doesNotThrow(() => insert.run("anonymous-a", "ABC123", null, "hash-d", "匿名 A", "静安寺", "now", "now"));
    assert.doesNotThrow(() => insert.run("anonymous-b", "ABC123", null, "hash-e", "匿名 B", "静安寺", "now", "now"));
  } finally {
    db.close();
  }
});

test("a linked-member insert conflict restores the existing seat and rotates its token", async () => {
  const memberLinkStore = await import("../lib/member-link-store.ts").catch(() => ({}));
  assert.equal(typeof memberLinkStore.insertStoredMember, "function");
  const db = await createMembershipDatabase();
  try {
    db.prepare("INSERT INTO members (id, room_code, user_id, token_hash, name, origin, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run("existing-member", "ABC123", "user-a", "old-hash", "用户 A", "静安寺", "now", "now");

    const resolution = await memberLinkStore.insertStoredMember(asD1Database(db), {
      id: "racing-member",
      roomCode: "ABC123",
      userId: "user-a",
      tokenHash: "rotated-hash",
      memberToken: "rotated-token",
      name: "用户 A",
      origin: "静安寺",
      originLocation: { lng: 121.45, lat: 31.23 },
      now: "later",
    });

    assert.deepEqual(resolution, {
      kind: "restored",
      identity: { memberId: "existing-member", memberToken: "rotated-token" },
    });
    const stored = db.prepare("SELECT id, token_hash FROM members WHERE room_code = ? AND user_id = ?").get("ABC123", "user-a");
    assert.equal(stored.id, "existing-member");
    assert.equal(stored.token_hash, "rotated-hash");
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM members WHERE room_code = ? AND user_id = ?").get("ABC123", "user-a").count, 1);
  } finally {
    db.close();
  }
});
