import assert from "node:assert/strict";
import test from "node:test";
import { hasSubmittedMembersAtAdvanceBoundary } from "../lib/round-store-guard.ts";

test("final storage boundary rejects a member who joined before the round update", async () => {
  const sql = [];
  const db = {
    prepare(statement) {
      sql.push(statement);
      return {
        bind(roomCode) {
          assert.equal(roomCode, "ABC123");
          return { first: async () => ({ total: 3, submitted: 2 }) };
        },
      };
    },
  };
  assert.equal(await hasSubmittedMembersAtAdvanceBoundary(db, "ABC123"), false);
  assert.match(sql[0], /submitted_at IS NOT NULL/);
});

test("final storage boundary accepts only a fully submitted current membership", async () => {
  const db = {
    prepare() {
      return { bind: () => ({ first: async () => ({ total: 2, submitted: 2 }) }) };
    },
  };
  assert.equal(await hasSubmittedMembersAtAdvanceBoundary(db, "ABC123"), true);
});
