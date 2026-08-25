import assert from "node:assert/strict";
import test from "node:test";
import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH, ROOM_CODE_PATTERN, randomRoomCode } from "../lib/room-code.ts";

test("room codes use the full alphanumeric alphabet, not just digits", () => {
  const codes = Array.from({ length: 400 }, () => randomRoomCode());
  for (const code of codes) assert.match(code, ROOM_CODE_PATTERN);

  const used = new Set(codes.join(""));
  assert.ok([...used].some((char) => /[A-Z]/.test(char)), "字母必须出现，否则 keyspace 退回 10^6");
  assert.ok(used.size > 20, `字符覆盖过窄：${used.size}`);
});

test("room code sampling rejects bytes that would bias the alphabet", () => {
  // 252 及以上会让 0-3 号字符多出一次命中机会，必须被丢弃而不是取模。
  const queue = [255, 254, 253, 252, 0, 1, 2, 3, 4, 5];
  const code = randomRoomCode((length) => Uint8Array.from(Array.from({ length }, () => queue.shift() ?? 0)));

  assert.equal(code.length, ROOM_CODE_LENGTH);
  assert.equal(code, [0, 1, 2, 3, 4, 5].map((index) => ROOM_CODE_ALPHABET[index]).join(""));
});
