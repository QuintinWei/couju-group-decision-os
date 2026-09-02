import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const migrationTags = [
  "0000_sudden_triton",
  "0001_workable_adam_warlock",
  "0002_wet_silhouette",
  "0003_loose_speed",
  "0004_add_rooms_updated_at_index",
  "0005_add_rejection_reasons",
  "0006_clear_historical_rooms",
  "0007_add_wechat_users",
  "0008_add_unique_room_user_membership",
  "0009_add_private_decision_round",
];

test("miniapp release contract keeps secrets out and documents real setup", async () => {
  const [project, profile, readme, envExample] = await Promise.all([
    readFile(new URL("../miniapp/project.config.json", import.meta.url), "utf8"),
    readFile(new URL("../miniapp/src/components/ProfileNickname/index.tsx", import.meta.url), "utf8"),
    readFile(new URL("../README.md", import.meta.url), "utf8"),
    readFile(new URL("../.env.example", import.meta.url), "utf8"),
  ]);
  assert.equal(JSON.parse(project).appid, "wx7162630074a237b6");
  assert.match(profile, /type=["']nickname["']/);
  assert.match(readme, /微信开发者工具/);
  assert.match(readme, /miniapp\/dist/);
  assert.doesNotMatch(project + profile + readme, /WECHAT_APP_SECRET\s*[:=]\s*[^\s"']+/);
  assert.match(envExample, /^WECHAT_APP_SECRET=\s*$/m);
  assert.match(envExample, /^WECHAT_TOKEN_SECRET=\s*$/m);
});

test("Drizzle metadata and SQL files form one ordered executable chain", async () => {
  const drizzleUrl = new URL("../drizzle/", import.meta.url);
  const metaUrl = new URL("../drizzle/meta/", import.meta.url);
  const [journalSource, migrationFiles, metadataFiles] = await Promise.all([
    readFile(new URL("_journal.json", metaUrl), "utf8"),
    readdir(drizzleUrl),
    readdir(metaUrl),
  ]);
  const journal = JSON.parse(journalSource);
  const sqlTags = migrationFiles
    .filter((file) => /^\d{4}_.+\.sql$/.test(file))
    .sort()
    .map((file) => file.replace(/\.sql$/, ""));
  const snapshots = metadataFiles
    .filter((file) => /^\d{4}_snapshot\.json$/.test(file))
    .sort();

  assert.deepEqual(sqlTags, migrationTags);
  assert.deepEqual(journal.entries.map(({ tag }) => tag), migrationTags);
  assert.deepEqual(journal.entries.map(({ idx }) => idx), migrationTags.map((_, index) => index));
  assert.deepEqual(snapshots, migrationTags.map((_, index) => `${String(index).padStart(4, "0")}_snapshot.json`));
  const snapshotChain = await Promise.all(snapshots.map(async (file) => JSON.parse(await readFile(new URL(file, metaUrl), "utf8"))));
  for (let index = 1; index < snapshotChain.length; index += 1) {
    assert.equal(snapshotChain[index].prevId, snapshotChain[index - 1].id, `${snapshots[index]} must follow the prior snapshot`);
  }
  assert.deepEqual(Object.keys(snapshotChain.at(-1).tables).sort(), ["members", "rooms", "users"]);

  const database = new DatabaseSync(":memory:");
  try {
    database.exec("PRAGMA foreign_keys = ON");
    for (const tag of migrationTags) {
      database.exec(await readFile(new URL(`${tag}.sql`, drizzleUrl), "utf8"));
    }
    assert.equal(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'users'").get().name, "users");
    const memberColumns = database.prepare("PRAGMA table_info(members)").all().map(({ name }) => name);
    for (const column of ["rejection_reasons_json", "user_id", "private_decision_round"]) {
      assert.ok(memberColumns.includes(column), `members.${column} must exist after the full chain`);
    }
    const memberIndexes = database.prepare("PRAGMA index_list(members)").all().map(({ name }) => name);
    assert.ok(memberIndexes.includes("members_user_id_idx"));
    assert.ok(memberIndexes.includes("members_room_user_id_unique"));
  } finally {
    database.close();
  }
});

test("README gates updated endpoints on the ordered remote D1 upgrade", async () => {
  const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
  const commands = [
    'npx wrangler d1 execute "$COUJU_D1_DATABASE" --remote --file=drizzle/0007_add_wechat_users.sql',
    'npx wrangler d1 execute "$COUJU_D1_DATABASE" --remote --file=drizzle/0008_add_unique_room_user_membership.sql',
    'npx wrangler d1 execute "$COUJU_D1_DATABASE" --remote --file=drizzle/0009_add_private_decision_round.sql',
  ];
  const positions = commands.map((command) => readme.indexOf(command));

  assert.ok(positions.every((position) => position >= 0), "all remote migration commands must be documented");
  assert.deepEqual(positions, positions.toSorted((left, right) => left - right));
  assert.match(readme, /0000–0006[^。]*已经应用/);
  assert.match(readme, /0003[^。]*0006[^。]*DELETE/);
  assert.match(readme, /认证、成员和轮次接口[^。]*0007[^。]*0008[^。]*0009/);
});

test("profile update persists only the server-confirmed nickname", async () => {
  const [{ createProfileService }, { createSessionStore }] = await Promise.all([
    import("../miniapp/src/services/profile-core.ts"),
    import("../miniapp/src/store/session-core.ts"),
  ]);
  const values = new Map();
  const store = createSessionStore({
    getStorageSync(key) { return values.get(key); },
    setStorageSync(key, value) { values.set(key, value); },
    removeStorageSync(key) { values.delete(key); },
  });
  const original = { accessToken: "access-token", user: { id: "user-1", nickname: "微信用户 A1B2" } };
  const calls = [];
  store.saveSession(original);
  const profile = createProfileService({
    loadSession: store.loadSession,
    saveSession: store.saveSession,
    request: async (path, options) => {
      calls.push({ path, options });
      return { user: { id: "user-1", nickname: "小明" } };
    },
  });

  assert.deepEqual(await profile.updateNickname("  <小>明  "), { id: "user-1", nickname: "小明" });
  assert.deepEqual(calls, [{
    path: "/api/users/profile",
    options: { method: "PATCH", data: { nickname: "  <小>明  " } },
  }]);
  assert.deepEqual(store.loadSession(), { accessToken: "access-token", user: { id: "user-1", nickname: "小明" } });
});

test("profile failure leaves the automatic nickname untouched", async () => {
  const [{ createProfileService }, { createSessionStore }] = await Promise.all([
    import("../miniapp/src/services/profile-core.ts"),
    import("../miniapp/src/store/session-core.ts"),
  ]);
  const values = new Map();
  const store = createSessionStore({
    getStorageSync(key) { return values.get(key); },
    setStorageSync(key, value) { values.set(key, value); },
    removeStorageSync(key) { values.delete(key); },
  });
  const original = { accessToken: "access-token", user: { id: "user-1", nickname: "微信用户 A1B2" } };
  store.saveSession(original);
  const profile = createProfileService({
    loadSession: store.loadSession,
    saveSession: store.saveSession,
    request: async () => { throw new Error("昵称更新失败，请稍后重试"); },
  });

  await assert.rejects(() => profile.updateNickname("小明"), /昵称更新失败/);
  assert.deepEqual(store.loadSession(), original);
});

test("miniapp mobile source keeps narrow layouts and states explicit", async () => {
  const [app, home, room, create, availability, homePage, roomPage, swipe, result, candidate, discovery] = await Promise.all([
    readFile(new URL("../miniapp/src/app.scss", import.meta.url), "utf8"),
    readFile(new URL("../miniapp/src/pages/home/index.scss", import.meta.url), "utf8"),
    readFile(new URL("../miniapp/src/pages/room/index.scss", import.meta.url), "utf8"),
    readFile(new URL("../miniapp/src/pages/create/index.scss", import.meta.url), "utf8"),
    readFile(new URL("../miniapp/src/pages/availability/index.scss", import.meta.url), "utf8"),
    readFile(new URL("../miniapp/src/pages/home/index.tsx", import.meta.url), "utf8"),
    readFile(new URL("../miniapp/src/pages/room/index.tsx", import.meta.url), "utf8"),
    readFile(new URL("../miniapp/src/pages/swipe/index.tsx", import.meta.url), "utf8"),
    readFile(new URL("../miniapp/src/pages/result/index.tsx", import.meta.url), "utf8"),
    readFile(new URL("../miniapp/src/components/CandidateCard/index.scss", import.meta.url), "utf8"),
    readFile(new URL("../miniapp/src/pages/discovery/index.scss", import.meta.url), "utf8"),
  ]);
  const pageStyles = home + room;
  assert.match(home, /flex-direction:\s*column/);
  assert.match(room, /flex-direction:\s*column/);
  assert.match(home, /calc\(24px \+ var\(--safe-area-bottom\)\)/);
  assert.match(room, /calc\(210px \+ var\(--safe-area-bottom\)\)/);
  assert.match(discovery, /calc\(284px \+ var\(--safe-area-bottom\)\)/);
  assert.match(room, /position:\s*fixed/);
  assert.match(room, /calc\(18px \+ var\(--safe-area-bottom\)\)/);
  assert.match(app, /button,\s*input\s*\{[^}]*min-height:\s*104px/s);
  assert.match(create, /\.picker-value\s*\{[^}]*min-height:\s*104px/s);
  assert.match(availability, /\.picker-value\s*\{[^}]*min-height:\s*104px/s);
  assert.doesNotMatch(pageStyles, /\.(?:home|create|room|availability|constraints)-page\s*\{[^}]*\bwidth:\s*\d+px/s);
  assert.match(candidate + discovery, /overflow-wrap:\s*anywhere/);
  assert.match(swipe, /正在加载共享卡/);
  assert.match(swipe, /当前共享卡不可用/);
  assert.match(result, /这一轮没有共同答案/);
  assert.match(homePage, /定位失败/);
  assert.match(roomPage, /房间刷新失败/);
});
