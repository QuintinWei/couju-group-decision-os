import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("wechat users are persisted without exposing secrets", async () => {
  const [schema, migration, loginRoute, profileRoute, envExample] = await Promise.all([
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0007_add_wechat_users.sql", import.meta.url), "utf8"),
    readFile(new URL("../app/api/auth/wechat/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/users/profile/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../.env.example", import.meta.url), "utf8"),
  ]);
  assert.match(schema, /users = sqliteTable\("users"/);
  assert.match(schema, /openid: text\("openid"\).*unique/s);
  assert.match(schema, /userId: text\("user_id"\)/);
  assert.match(migration, /CREATE TABLE `users`/);
  assert.match(loginRoute, /exchangeWechatCode/);
  assert.match(loginRoute, /WECHAT_APP_SECRET/);
  assert.doesNotMatch(loginRoute, /session_key.*Response\.json/s);
  assert.match(profileRoute, /authenticateRequestUser/);
  assert.match(envExample, /WECHAT_APP_SECRET=/);
  assert.match(envExample, /WECHAT_TOKEN_SECRET=/);
});
