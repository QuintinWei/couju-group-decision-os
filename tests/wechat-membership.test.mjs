import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("miniapp membership binds users while H5 remains anonymous-compatible", async () => {
  const [store, rooms, members] = await Promise.all([
    readFile(new URL("../lib/room-store.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/rooms/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/members/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(store, /userId\?: string \| null/);
  assert.match(store, /restoreStoredMembership/);
  assert.match(store, /UPDATE members SET token_hash = \?/);
  assert.match(rooms, /authenticateRequestUser/);
  assert.match(rooms, /currentUser\?\.nickname \|\| creatorName/);
  assert.match(members, /export async function GET/);
  assert.match(members, /currentUser\?\.nickname \|\| name/);
});
