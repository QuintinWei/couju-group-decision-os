import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

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
  assert.match(envExample, /WECHAT_TOKEN_SECRET=/);
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
