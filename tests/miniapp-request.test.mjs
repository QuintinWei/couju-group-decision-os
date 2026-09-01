import assert from "node:assert/strict";
import test from "node:test";

import { createSessionStore } from "../miniapp/src/store/session-core.ts";
import { ApiError, createApiRequest } from "../miniapp/src/services/request-core.ts";
import { createWechatLogin } from "../miniapp/src/services/auth-core.ts";

function createTaroStorage() {
  const values = new Map();
  return {
    getStorageSync(key) { return values.get(key); },
    setStorageSync(key, value) { values.set(key, value); },
    removeStorageSync(key) { values.delete(key); },
  };
}

const session = { accessToken: "access-token", user: { id: "user-1", nickname: "凑局用户" } };
const membership = { roomCode: "AB12CD", memberId: "member-1", memberToken: "member-token" };

test("request passes the configured endpoint, timeout, bearer token, and server membership field", async () => {
  const taro = createTaroStorage();
  const store = createSessionStore(taro);
  store.saveSession(session);
  const calls = [];
  const apiRequest = createApiRequest({
    apiBase: "https://api.example.test/",
    store,
    request: async (options) => {
      calls.push(options);
      return { statusCode: 200, data: { ok: true } };
    },
  });

  const result = await apiRequest("/api/members", { method: "PATCH", data: { action: "constraints" }, membership });

  assert.deepEqual(result, { ok: true });
  assert.deepEqual(calls, [{
    url: "https://api.example.test/api/members",
    method: "PATCH",
    data: { action: "constraints", roomCode: "AB12CD", memberId: "member-1", token: "member-token" },
    timeout: 12_000,
    header: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: "Bearer access-token",
    },
  }]);
});

test("AI callers can extend the transport timeout beyond the default", async () => {
  const calls = [];
  const apiRequest = createApiRequest({
    apiBase: "https://api.example.test",
    store: createSessionStore(createTaroStorage()),
    request: async (options) => {
      calls.push(options);
      return { statusCode: 200, data: { ok: true } };
    },
  });

  await apiRequest("/api/insights", { method: "POST", data: {}, timeout: 20_000 });
  assert.equal(calls[0].timeout, 20_000);
});

test("request rejects a missing configured API endpoint before invoking Taro", async () => {
  const store = createSessionStore(createTaroStorage());
  let invoked = false;
  const apiRequest = createApiRequest({
    apiBase: "",
    store,
    request: async () => {
      invoked = true;
      return { statusCode: 200, data: {} };
    },
  });

  await assert.rejects(() => apiRequest("/api/auth/wechat"), /请配置 TARO_APP_API_BASE/);
  assert.equal(invoked, false);
});

test("401 clears the session without removing stored room membership", async () => {
  const taro = createTaroStorage();
  const store = createSessionStore(taro);
  store.saveSession(session);
  store.saveMembership(membership);
  const apiRequest = createApiRequest({ apiBase: "https://api.example.test", store, request: async () => ({ statusCode: 401, data: { error: "登录状态已失效" } }) });

  await assert.rejects(() => apiRequest("/api/rooms", { membership }), (error) => error instanceof ApiError && error.status === 401);
  assert.equal(store.loadSession(), null);
  assert.deepEqual(store.loadMembership("AB12CD"), membership);
});

test("member 403 removes only the failed room membership and retains the session", async () => {
  const taro = createTaroStorage();
  const store = createSessionStore(taro);
  store.saveSession(session);
  store.saveMembership(membership);
  store.saveMembership({ roomCode: "ZX98YU", memberId: "member-2", memberToken: "other-token" });
  const apiRequest = createApiRequest({ apiBase: "https://api.example.test", store, request: async () => ({ statusCode: 403, data: { error: "成员身份已失效" } }) });

  await assert.rejects(() => apiRequest("/api/members", { membership }), (error) => error instanceof ApiError && error.status === 403);
  assert.equal(store.loadMembership("AB12CD"), null);
  assert.deepEqual(store.loadMembership("ZX98YU"), { roomCode: "ZX98YU", memberId: "member-2", memberToken: "other-token" });
  assert.deepEqual(store.loadSession(), session);
});

test("WeChat login posts the fresh code and persists the returned session", async () => {
  const taro = createTaroStorage();
  const store = createSessionStore(taro);
  const calls = [];
  const apiRequest = createApiRequest({
    apiBase: "https://api.example.test",
    store,
    request: async (options) => {
      calls.push(options);
      return { statusCode: 200, data: session };
    },
  });
  const loginWithWechat = createWechatLogin({ login: async () => ({ code: "fresh-code" }), apiRequest, saveSession: store.saveSession });

  assert.deepEqual(await loginWithWechat(), session);
  assert.deepEqual(calls[0].data, { code: "fresh-code" });
  assert.equal(calls[0].method, "POST");
  assert.deepEqual(store.loadSession(), session);
});

test("WeChat login does not persist or invent an identity after a failed request", async () => {
  const store = createSessionStore(createTaroStorage());
  const loginWithWechat = createWechatLogin({
    login: async () => ({ code: "fresh-code" }),
    apiRequest: async () => { throw new ApiError(503, "微信登录暂时不可用"); },
    saveSession: store.saveSession,
  });

  await assert.rejects(() => loginWithWechat(), /微信登录暂时不可用/);
  assert.equal(store.loadSession(), null);
});

test("retrying WeChat login obtains a new code and persists only the successful session", async () => {
  const store = createSessionStore(createTaroStorage());
  const codes = ["expired-code", "fresh-code"];
  const sentCodes = [];
  const loginWithWechat = createWechatLogin({
    login: async () => ({ code: codes.shift() }),
    apiRequest: async (_path, options) => {
      sentCodes.push(options.data.code);
      if (sentCodes.length === 1) throw new ApiError(503, "微信登录暂时不可用");
      return session;
    },
    saveSession: store.saveSession,
  });

  await assert.rejects(() => loginWithWechat(), /微信登录暂时不可用/);
  assert.equal(store.loadSession(), null);
  assert.deepEqual(await loginWithWechat(), session);
  assert.deepEqual(sentCodes, ["expired-code", "fresh-code"]);
  assert.deepEqual(store.loadSession(), session);
});
