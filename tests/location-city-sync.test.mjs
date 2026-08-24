import assert from "node:assert/strict";
import test from "node:test";

test("a supported detected city becomes both the displayed and requested city", async () => {
  const { synchronizeDetectedLocation } = await import("../lib/location-sync.ts");
  const result = synchronizeDetectedLocation(
    { city: "上海", kind: "dining" },
    { city: "杭州", location: { lng: 120.1551, lat: 30.2741 }, label: "杭州 · 西湖区" },
  );

  assert.equal(result.config.city, "杭州");
  assert.equal(result.candidateRequest.city, "杭州");
  assert.deepEqual(result.candidateRequest.location, { lng: 120.1551, lat: 30.2741 });
});

test("an unsupported or missing detected city never silently changes the selected city", async () => {
  const { synchronizeDetectedLocation } = await import("../lib/location-sync.ts");
  const result = synchronizeDetectedLocation(
    { city: "北京", kind: "activity" },
    { city: null, location: { lng: 116.3974, lat: 39.9093 }, label: "当前位置" },
  );

  assert.equal(result.config.city, "北京");
  assert.equal(result.candidateRequest.city, "北京");
});
