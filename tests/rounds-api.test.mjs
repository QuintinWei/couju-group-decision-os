import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function fetchFromApp(path, init = {}) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${Math.random()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request(`http://localhost${path}`, init),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("round actions reject missing member credentials", async () => {
  const response = await fetchFromApp("/api/rounds", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "request", roomCode: "ABC123" }),
  });

  assert.equal(response.status, 400);
  const payload = await response.json();
  assert.match(payload.error, /成员身份/);
});

test("candidate endpoint private mode returns three unseen cards", async () => {
  const response = await fetchFromApp("/api/candidates?city=%E4%B8%8A%E6%B5%B7&kind=activity&strategy=private&limit=3&exclude=%E4%B8%8A%E6%B5%B7-massage,%E4%B8%8A%E6%B5%B7-climb&seed=private-test");
  assert.equal(response.status, 200);

  const payload = await response.json();
  assert.equal(payload.candidates.length, 3);
  assert.equal(payload.meta.strategy, "private");
  assert.match(payload.meta.label, /私人发现/);
  assert.equal(new Set(payload.candidates.map((candidate) => candidate.id)).size, 3);
  assert.ok(payload.candidates.every((candidate) => !["上海-massage", "上海-climb"].includes(candidate.id)));
});

test("private candidate strategy requires a three-card limit", async () => {
  const response = await fetchFromApp("/api/candidates?city=%E4%B8%8A%E6%B5%B7&kind=activity&strategy=private&limit=4");
  assert.equal(response.status, 400);
});

test("shared candidate strategy supplies twelve distinct activity cards", async () => {
  const response = await fetchFromApp("/api/candidates?city=%E4%B8%8A%E6%B5%B7&kind=activity&strategy=explore&seed=round-one");
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.candidates.length, 12);
  assert.equal(new Set(payload.candidates.map((candidate) => candidate.id)).size, 12);
});

test("demo inventory sustains private discovery and three no-repeat shared rounds", async () => {
  const load = async (query) => {
    const response = await fetchFromApp(`/api/candidates?city=%E4%B8%8A%E6%B5%B7&kind=activity${query}`);
    assert.equal(response.status, 200);
    return response.json();
  };
  const first = await load("&strategy=explore&seed=first");
  const firstIds = first.candidates.map((candidate) => candidate.id);
  const privateBatch = await load(`&strategy=private&limit=3&seed=private&exclude=${encodeURIComponent(firstIds.join(","))}`);
  const second = await load(`&strategy=learn&seed=second&exclude=${encodeURIComponent(firstIds.join(","))}`);
  const secondIds = second.candidates.map((candidate) => candidate.id);
  const third = await load(`&strategy=explore&seed=third&exclude=${encodeURIComponent([...firstIds, ...secondIds].join(","))}`);

  assert.equal(privateBatch.candidates.length, 3);
  assert.equal(second.candidates.length, 12);
  assert.equal(third.candidates.length, 12);
  assert.equal(new Set([...firstIds, ...secondIds, ...third.candidates.map((candidate) => candidate.id)]).size, 36);
});

test("round API rejects coercible round values and non-boolean refresh requests", async () => {
  const base = { roomCode: "ABC123", memberId: "member", token: "token" };
  const booleanRound = await fetchFromApp("/api/rounds", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...base, action: "request", expectedRound: true }),
  });
  const stringRequest = await fetchFromApp("/api/rounds", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...base, action: "request", expectedRound: 1, requested: "yes" }),
  });
  assert.equal(booleanRound.status, 400);
  assert.equal(stringRequest.status, 400);
});

test("room creation rejects a shared batch that is not exactly twelve cards", async () => {
  const discovery = await fetchFromApp("/api/candidates?city=%E4%B8%8A%E6%B5%B7&kind=dining&strategy=explore&seed=room-validation");
  const payload = await discovery.json();
  const response = await fetchFromApp("/api/rooms", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      config: { city: "上海", kind: "dining", date: "2026-08-24", startTime: "18:00", endTime: "21:30", people: 2 },
      candidates: payload.candidates.slice(0, 11), meta: payload.meta, creatorName: "测试", creatorOrigin: "静安寺",
    }),
  });
  assert.equal(response.status, 400);
});

test("room creation rejects twelve cards that repeat a provider", async () => {
  const discovery = await fetchFromApp("/api/candidates?city=%E4%B8%8A%E6%B5%B7&kind=dining&strategy=explore&seed=duplicate-validation");
  const payload = await discovery.json();
  const candidates = [...payload.candidates.slice(0, 11), payload.candidates[0]];
  const response = await fetchFromApp("/api/rooms", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      config: { city: "上海", kind: "dining", date: "2026-08-24", startTime: "18:00", endTime: "21:30", people: 2 },
      candidates, meta: payload.meta, creatorName: "测试", creatorOrigin: "静安寺",
    }),
  });
  assert.equal(response.status, 400);
});

test("round sources keep history exclusions, creator gating, and atomic submitted-member checks", async () => {
  const [roundRoute, roomStore] = await Promise.all([
    readFile(new URL("../app/api/rounds/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/room-store.ts", import.meta.url), "utf8"),
  ]);
  assert.match(roundRoute, /room\.roundHistory\.flatMap\(\(entry\) => entry\.candidateIds\)/);
  assert.match(roundRoute, /room\.members\[0\]\?\.id !== auth\.memberId/);
  assert.match(roundRoute, /return error\("只有房主可以发起下一轮", 403\)/);
  assert.match(roundRoute, /return error\("房间已进入下一轮，请刷新后继续", 409\)/);
  assert.match(roundRoute, /return error\("已经是第三轮，无法继续换一批", 429\)/);
  assert.match(roundRoute, /return error\("只有拒绝本轮全部 12 张共享候选后，才能开启私人发现", 422\)/);
  assert.ok(roundRoute.indexOf("buildNextRoundSlots") < roundRoute.indexOf("advanceStoredRound({"));
  assert.match(roomStore, /privateRejectedCandidateIds/);
  assert.match(roomStore, /submitted_at IS NOT NULL/);
  assert.match(roomStore, /"private"/);
});
