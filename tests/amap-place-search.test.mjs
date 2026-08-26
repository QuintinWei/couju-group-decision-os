import test from "node:test";
import assert from "node:assert/strict";

test("a group center uses Amap nearby search instead of citywide text search", async () => {
  const { buildAmapPlaceSearchUrl } = await import("../lib/amap-place-search.ts");
  const url = new URL(buildAmapPlaceSearchUrl({
    key: "test-key",
    city: "北京",
    kind: "dining",
    interest: "火锅",
    page: 2,
    center: { lng: 116.3002, lat: 40.0233 },
  }));
  assert.equal(url.pathname, "/v5/place/around");
  assert.equal(url.searchParams.get("location"), "116.3002,40.0233");
  assert.equal(url.searchParams.get("radius"), "50000");
  assert.equal(url.searchParams.get("page_num"), "2");
});

test("a missing center keeps the city-limited text search", async () => {
  const { buildAmapPlaceSearchUrl } = await import("../lib/amap-place-search.ts");
  const url = new URL(buildAmapPlaceSearchUrl({ key: "test-key", city: "北京", kind: "activity", interest: "攀岩", page: 1, center: null }));
  assert.equal(url.pathname, "/v5/place/text");
  assert.equal(url.searchParams.get("region"), "北京市");
});

test("nearby searches at different group centers never share a cache entry", async () => {
  const { amapCacheKeyUrl } = await import("../lib/amap-cache.ts");
  const base = { city: "北京", kind: "dining", interest: "火锅", page: 1 };
  const first = amapCacheKeyUrl({ ...base, center: { lng: 116.30, lat: 40.02 } });
  const second = amapCacheKeyUrl({ ...base, center: { lng: 116.48, lat: 39.99 } });
  assert.notEqual(first, second);
});
