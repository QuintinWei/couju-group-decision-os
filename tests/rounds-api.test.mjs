import assert from "node:assert/strict";
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
