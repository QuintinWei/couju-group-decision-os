import assert from "node:assert/strict";
import test from "node:test";
import { getRoundControlVisibility, reconcileAuthoritativeRound } from "../lib/round-client-state.ts";

test("external or local successful advance resets only round-scoped client state", () => {
  assert.deepEqual(reconcileAuthoritativeRound({ knownRound: 1, nextRound: 2 }), {
    roundChanged: true,
    resetRoundScopedState: true,
    nextStage: "room",
  });
  assert.deepEqual(reconcileAuthoritativeRound({ knownRound: null, nextRound: 1 }), {
    roundChanged: false,
    resetRoundScopedState: false,
    nextStage: null,
  });
});

test("same-round stale refresh preserves local choices and creator visibility follows submitted membership", () => {
  assert.deepEqual(reconcileAuthoritativeRound({ knownRound: 2, nextRound: 2 }), {
    roundChanged: false,
    resetRoundScopedState: false,
    nextStage: null,
  });
  assert.deepEqual(getRoundControlVisibility({ currentRound: 2, creatorId: "creator", memberId: "creator", allSubmitted: true, submitted: true }), {
    isCreator: true,
    canAdvance: true,
    canRequestRefresh: false,
  });
  assert.deepEqual(getRoundControlVisibility({ currentRound: 2, creatorId: "creator", memberId: "member", allSubmitted: true, submitted: true }), {
    isCreator: false,
    canAdvance: false,
    canRequestRefresh: true,
  });
  assert.deepEqual(getRoundControlVisibility({ currentRound: 2, creatorId: "creator", memberId: "creator", allSubmitted: false, submitted: true }), {
    isCreator: true,
    canAdvance: false,
    canRequestRefresh: false,
  });
  assert.deepEqual(getRoundControlVisibility({ currentRound: 2, creatorId: "creator", memberId: "member", allSubmitted: false, submitted: false }), {
    isCreator: false,
    canAdvance: false,
    canRequestRefresh: false,
  });
  assert.deepEqual(getRoundControlVisibility({ currentRound: 3, creatorId: "creator", memberId: "member", allSubmitted: true, submitted: true }), {
    isCreator: false,
    canAdvance: false,
    canRequestRefresh: false,
  });
});
