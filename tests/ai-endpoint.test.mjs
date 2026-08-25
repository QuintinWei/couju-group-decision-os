import assert from "node:assert/strict";
import test from "node:test";
import { parseAiEndpointCaller, sanitizeExplainPayload } from "../lib/ai-endpoint.ts";

test("explain payload is capped so a caller cannot inflate the prompt", () => {
  const { candidates, members } = sanitizeExplainPayload({
    candidates: Array.from({ length: 10 }, (unused, index) => ({
      name: "很长的店名".repeat(500),
      groupFit: 91,
      minUtility: 82,
      meanUtility: 88,
      geoMean: 86,
      evidence: Array.from({ length: 12 }, () => "证据".repeat(400)),
      padding: "x".repeat(100_000),
      index,
    })),
    members: Array.from({ length: 20 }, () => ({ budget: "≤ ¥150", commute: "≤ 60 分钟" })),
  });

  assert.equal(candidates.length, 3);
  assert.equal(members.length, 6);
  assert.ok(candidates.every((candidate) => candidate.name.length <= 40));
  assert.ok(candidates.every((candidate) => candidate.evidence.length <= 4));
  assert.ok(candidates.every((candidate) => candidate.evidence.every((line) => line.length <= 60)));
  assert.doesNotMatch(JSON.stringify(candidates), /padding|xxxx/);
  assert.ok(JSON.stringify({ candidates, members }).length < 2000);
});

test("member names and origins never reach the explanation prompt", () => {
  const { members } = sanitizeExplainPayload({
    candidates: [{ name: "山野云贵菜", groupFit: 91, minUtility: 82, meanUtility: 88, geoMean: 86, evidence: [] }],
    members: [{ name: "小明", origin: "静安寺地铁站", note: "我对花生过敏", budget: "≤ ¥150", commute: "≤ 30 分钟" }],
  });

  assert.deepEqual(members, [{ budget: "≤ ¥150", commute: "≤ 30 分钟" }]);
  assert.doesNotMatch(JSON.stringify(members), /小明|静安寺|过敏/);
});

test("non-numeric scores and nameless candidates are dropped instead of forwarded", () => {
  const { candidates } = sanitizeExplainPayload({
    candidates: [
      { name: "", groupFit: 91 },
      { name: "有名字的店", groupFit: "not-a-number", minUtility: 999, meanUtility: -5, geoMean: 70.6, evidence: ["ok", 42, null] },
    ],
    members: [{}],
  });

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].groupFit, 0);
  assert.equal(candidates[0].minUtility, 100);
  assert.equal(candidates[0].meanUtility, 0);
  assert.equal(candidates[0].geoMean, 71);
  assert.deepEqual(candidates[0].evidence, ["ok"]);
});

test("AI endpoints require a well-formed member identity before spending the key", () => {
  assert.equal(parseAiEndpointCaller({ roomCode: "ABC123", memberId: "member", token: "token" }).roomCode, "ABC123");
  assert.equal(parseAiEndpointCaller({ roomCode: "abc123", memberId: "member", token: "token" }).roomCode, "ABC123");
  assert.equal(parseAiEndpointCaller({ roomCode: "ABC12", memberId: "member", token: "token" }), null);
  assert.equal(parseAiEndpointCaller({ roomCode: "ABC123", memberId: "member" }), null);
  assert.equal(parseAiEndpointCaller({ roomCode: "ABC123", memberId: 42, token: "token" }), null);
  assert.equal(parseAiEndpointCaller({}), null);
});
