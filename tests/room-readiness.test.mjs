import assert from "node:assert/strict";
import test from "node:test";

import { getRoomReadiness } from "../lib/room-readiness.ts";

test("shared cards stay locked until the target group has joined and submitted locations/time", () => {
  assert.deepEqual(getRoomReadiness({ targetCount: 4, members: [
    { originLocation: { lng: 121.4, lat: 31.2 }, availability: [{}] },
  ] }), { groupComplete: false, locationsComplete: false, availabilityComplete: false, canStartSelection: false });

  assert.equal(getRoomReadiness({ targetCount: 2, members: [
    { originLocation: { lng: 121.4, lat: 31.2 }, availability: [{}] },
    { originLocation: { lng: 121.5, lat: 31.3 }, availability: [{}] },
  ] }).canStartSelection, true);
});

test("a missing member location never permits group selection", () => {
  const readiness = getRoomReadiness({ targetCount: 2, members: [
    { originLocation: { lng: 121.4, lat: 31.2 }, availability: [{}] },
    { originLocation: null, availability: [{}] },
  ] });
  assert.equal(readiness.groupComplete, true);
  assert.equal(readiness.locationsComplete, false);
  assert.equal(readiness.canStartSelection, false);
});

test("participant polling can derive readiness from redacted peer status flags", () => {
  assert.deepEqual(getRoomReadiness({ targetCount: 2, members: [
    { locationReady: true, availabilitySubmitted: true },
    { locationReady: true, availabilitySubmitted: true },
  ] }), { groupComplete: true, locationsComplete: true, availabilityComplete: true, canStartSelection: true });
});
