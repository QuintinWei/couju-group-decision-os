import assert from "node:assert/strict";
import test from "node:test";
import { selectGroupReachableCandidates } from "../lib/group-candidate-intersection.ts";

const candidate = (id, lng) => ({ id, type: id.split("-")[0], rating: 4.5, location: { lng, lat: 31.2 }, source: { providerId: id } });

test("shared candidates must fit every member's own commute limit", () => {
  const members = [
    { originLocation: { lng: 121.3, lat: 31.2 }, commuteLabel: "≤ 60 分钟" },
    { originLocation: { lng: 121.5, lat: 31.2 }, commuteLabel: "≤ 30 分钟" },
  ];
  const selected = selectGroupReachableCandidates([candidate("火锅-a", 121.44), candidate("日料-b", 121.31)], members, 12);
  assert.deepEqual(selected.map((item) => item.id), ["火锅-a"]);
});

test("intersection never fills with candidates outside one member's limit", () => {
  const members = [{ originLocation: { lng: 121.5, lat: 31.2 }, commuteLabel: "≤ 30 分钟" }];
  assert.equal(selectGroupReachableCandidates([candidate("远处-a", 120.0)], members, 12).length, 0);
});
