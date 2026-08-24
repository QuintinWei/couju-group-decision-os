import assert from "node:assert/strict";
import test from "node:test";
import { amapPagesForBatch, selectCandidateBatch } from "../lib/candidate-pool.ts";
import { CITY_PROFILES, SUPPORTED_CITIES, getDemoCandidates } from "../lib/couju.ts";

test("supports all ten launch cities with complete demo inventory", () => {
  assert.deepEqual(SUPPORTED_CITIES, ["上海", "北京", "广州", "深圳", "杭州", "成都", "南京", "重庆", "苏州", "合肥"]);
  for (const city of SUPPORTED_CITIES) {
    assert.ok(CITY_PROFILES[city]);
    assert.ok(getDemoCandidates(city, "dining").length >= 12);
    assert.ok(getDemoCandidates(city, "activity").length >= 12);
  }
});

test("rotates two Amap result pages over five batches", () => {
  assert.deepEqual(amapPagesForBatch(0), [1, 2]);
  assert.deepEqual(amapPagesForBatch(1), [3, 4]);
  assert.deepEqual(amapPagesForBatch(2), [5, 1]);
  assert.deepEqual(amapPagesForBatch(5), [1, 2]);
});

test("selects unique quality and exploration candidates without repeated brands", () => {
  const pool = Array.from({ length: 24 }, (_, index) => ({
    id: `id-${index}`,
    name: index < 2 ? `好味火锅（${index ? "浦东" : "静安"}店）` : `地点 ${index}`,
    kind: "dining",
    rating: index < 10 ? 4.8 - index / 100 : null,
    source: { providerId: `poi-${index}` },
  }));
  const result = selectCandidateBatch(pool, { excludedIds: new Set(["poi-2"]), batchSize: 12, seed: "room-1", kind: "dining" });
  assert.equal(result.length, 12);
  assert.equal(new Set(result.map((item) => item.source.providerId)).size, 12);
  assert.equal(result.some((item) => item.source.providerId === "poi-2"), false);
  assert.equal(result.filter((item) => item.name.startsWith("好味火锅")).length, 1);
  assert.ok(result.some((item) => item.rating === null));
});
