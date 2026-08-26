import assert from "node:assert/strict";
import test from "node:test";
import { getPreferenceEntryStage, getRefreshRequestControl, getRoundControlVisibility, reconcileAuthoritativeRound } from "../lib/round-client-state.ts";

test("an advanced room enters the shared cards without repeating first-round setup", () => {
  assert.equal(getPreferenceEntryStage({ currentRound: 2, constraintsReady: true, groupIntersection: false }), "swipe");
  assert.equal(getPreferenceEntryStage({ currentRound: 1, constraintsReady: true, groupIntersection: true }), "swipe");
  assert.equal(getPreferenceEntryStage({ currentRound: 1, constraintsReady: true, groupIntersection: false }), "setup");
});

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

test("a member can request and then cancel the current round refresh", () => {
  assert.deepEqual(getRefreshRequestControl({ canRequestRefresh: true, requested: false }), { visible: true, requested: false, label: "这批都没感觉，请求换一批", nextRequested: true });
  assert.deepEqual(getRefreshRequestControl({ canRequestRefresh: true, requested: true }), { visible: true, requested: true, label: "取消换一批请求", nextRequested: false });
  assert.deepEqual(getRefreshRequestControl({ canRequestRefresh: false, requested: true }), { visible: false, requested: true, label: "取消换一批请求", nextRequested: false });
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
