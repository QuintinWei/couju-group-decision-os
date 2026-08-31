import assert from "node:assert/strict";
import test from "node:test";
import {
  membershipStorageKey,
  normalizeRoomCode,
  resolveLaunchRoom,
} from "../miniapp/src/domain/session.ts";

test("launch room accepts only a six-character room code", () => {
  assert.equal(resolveLaunchRoom({ room: " ab12cd " }), "AB12CD");
  assert.equal(resolveLaunchRoom({ room: "bad" }), null);
});

test("membership storage is isolated by room", () => {
  assert.equal(membershipStorageKey("AB12CD"), "couju:membership:AB12CD");
  assert.equal(normalizeRoomCode("a-b"), "AB");
});
