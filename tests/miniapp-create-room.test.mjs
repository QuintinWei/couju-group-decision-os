import assert from "node:assert/strict";
import test from "node:test";

import {
  initialCreateDraft,
  validateCreateDraft,
} from "../miniapp/src/domain/create-room.ts";
import { createRoomsService } from "../miniapp/src/services/rooms-core.ts";
import { requestDevicePosition } from "../miniapp/src/services/location-core.ts";

const user = { id: "user-one", nickname: "微信用户 A1B2" };
const point = { lng: 121.4737, lat: 31.2304 };

function candidate(index, providerId = `provider-${index}`) {
  return {
    id: `candidate-${index}`,
    kind: "dining",
    city: "上海",
    type: "餐厅",
    name: `候选 ${index}`,
    meta: "适合聚会",
    image: "/candidate.jpg",
    priceValue: 100,
    priceLabel: "¥100/人",
    durationMinutes: 120,
    durationLabel: "建议预留 2 小时",
    address: "测试路 1 号",
    district: "静安区",
    location: point,
    estimatedTravelMinutes: 20,
    rating: 4.5,
    openToday: null,
    source: { mode: "demo", label: "测试", fetchedAt: "2026-08-31T00:00:00.000Z", providerId },
    features: { indoor: true, quiet: true, conversationFriendly: true, nonSpicyAvailable: true, queueRisk: "low" },
  };
}

function validDraft() {
  return {
    ...initialCreateDraft("dining", "2026-09-01"),
    origin: "静安寺地铁站",
    originLocation: null,
  };
}

test("room kind comes from the home choice and nickname is not a create field", () => {
  const dining = initialCreateDraft("dining", "2026-09-01");
  const activity = initialCreateDraft("activity", "2026-09-01");

  assert.equal(dining.kind, "dining");
  assert.equal(activity.kind, "activity");
  assert.equal("nickname" in dining, false);
});

test("creation reports the first missing required field", () => {
  const result = validateCreateDraft({ ...initialCreateDraft("activity", "2026-09-01"), city: "上海" });

  assert.deepEqual(result, { ok: false, message: "请填写出发地" });
  assert.deepEqual(validateCreateDraft({ ...validDraft(), preferredPeriods: [] }), { ok: false, message: "请选择大概时段" });
  assert.deepEqual(validateCreateDraft({ ...validDraft(), people: 7 }), { ok: false, message: "请选择 2–6 人" });
});

test("uncertain duration remains a valid explicit duration choice", () => {
  assert.deepEqual(validateCreateDraft({ ...validDraft(), durationMinutes: null }), { ok: true });
});

test("creation geocodes first, fetches exactly twelve unique candidates, and omits creatorName", async () => {
  const calls = [];
  const candidates = Array.from({ length: 12 }, (_, index) => candidate(index));
  const service = createRoomsService({
    resolveOrigin: async (city, origin) => {
      calls.push({ type: "resolve", city, origin });
      return { location: point, label: "静安寺" };
    },
    request: async (path, options = {}) => {
      calls.push({ type: "request", path, options });
      if (path.startsWith("/api/candidates?")) return { candidates, meta: { mode: "demo", label: "测试", fetchedAt: "2026-08-31T00:00:00.000Z" } };
      return { identity: { code: "AB12CD", memberId: "member-one", memberToken: "member-secret" } };
    },
    saveMembership: (membership) => calls.push({ type: "save", membership }),
    createSeed: () => "seed-one",
  });

  const membership = await service.createRoom({
    ...validDraft(),
    discoveryMode: "ideas",
    tendencies: ["日料", "火锅"],
    avoid: "不要辣， 不要排队",
  }, user);

  assert.deepEqual(calls.map((call) => call.type), ["resolve", "request", "request", "save"]);
  assert.match(calls[1].path, /^\/api\/candidates\?/);
  assert.match(calls[1].path, /strategy=focused/);
  assert.match(calls[1].path, /interests=/);
  assert.equal(calls[2].path, "/api/rooms");
  assert.equal(calls[2].options.method, "POST");
  assert.equal(calls[2].options.data.candidates.length, 12);
  assert.equal("creatorName" in calls[2].options.data, false);
  assert.equal(calls[2].options.data.creatorOrigin, "静安寺");
  assert.deepEqual(membership, { roomCode: "AB12CD", memberId: "member-one", memberToken: "member-secret" });
});

test("creation never posts a room when the candidate response is not twelve unique places", async () => {
  const roomPosts = [];
  const duplicateCandidates = Array.from({ length: 12 }, (_, index) => candidate(index, index === 11 ? "provider-0" : `provider-${index}`));
  const service = createRoomsService({
    resolveOrigin: async () => ({ location: point, label: "静安寺" }),
    request: async (path, options = {}) => {
      if (path.startsWith("/api/candidates?")) return { candidates: duplicateCandidates, meta: { mode: "demo", label: "测试", fetchedAt: "2026-08-31T00:00:00.000Z" } };
      roomPosts.push({ path, options });
      return {};
    },
    saveMembership: () => {},
    createSeed: () => "seed-two",
  });

  await assert.rejects(() => service.createRoom(validDraft(), user), /需要正好 12 个不重复候选/);
  assert.equal(roomPosts.length, 0);
});

test("join sends only room code, origin, and optional coordinates before saving membership", async () => {
  const calls = [];
  const service = createRoomsService({
    resolveOrigin: async () => ({ location: point, label: "unused" }),
    request: async (path, options = {}) => {
      calls.push({ path, options });
      return { identity: { id: "member-two", token: "join-secret" } };
    },
    saveMembership: (membership) => calls.push({ membership }),
    createSeed: () => "seed-three",
  });

  const membership = await service.joinRoom(" ab12cd ", "徐家汇", point);

  assert.equal(calls[0].path, "/api/members");
  assert.deepEqual(calls[0].options.data, { roomCode: "AB12CD", origin: "徐家汇", originLocation: point });
  assert.equal("name" in calls[0].options.data, false);
  assert.equal("nickname" in calls[0].options.data, false);
  assert.deepEqual(membership, { roomCode: "AB12CD", memberId: "member-two", memberToken: "join-secret" });
});

test("device location denial and timeout reject so manual origin remains available", async () => {
  await assert.rejects(
    () => requestDevicePosition(() => Promise.reject(new Error("auth deny")), 20),
    /未授权定位/,
  );
  await assert.rejects(
    () => requestDevicePosition(() => new Promise(() => {}), 5),
    /定位超时/,
  );
});
