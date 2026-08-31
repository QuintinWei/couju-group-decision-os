import assert from "node:assert/strict";
import test from "node:test";
import * as wechatAuth from "../lib/wechat-auth.ts";
import {
  automaticNickname,
  createAccessToken,
  exchangeWechatCode,
  verifyAccessToken,
} from "../lib/wechat-auth.ts";

test("wechat code is exchanged without exposing the app secret", async () => {
  let requested = "";
  const result = await exchangeWechatCode("one-use-code", {
    appId: "wx7162630074a237b6",
    appSecret: "server-secret",
  }, async (url) => {
    requested = String(url);
    return Response.json({ openid: "openid-1", session_key: "never-return-this" });
  });
  assert.equal(result.openid, "openid-1");
  assert.match(requested, /js_code=one-use-code/);
  assert.deepEqual(Object.keys(result), ["openid"]);
});

test("wechat code exchange rejects malformed openids", async () => {
  for (const openid of [123, "   "]) {
    await assert.rejects(
      exchangeWechatCode("one-use-code", {
        appId: "wx7162630074a237b6",
        appSecret: "server-secret",
      }, async () => Response.json({ openid })),
      { message: "WECHAT_LOGIN_FAILED" },
    );
  }
});

test("signed access tokens reject tampering and expiry", async () => {
  const token = await createAccessToken("user-1", 1_000, "token-secret");
  assert.deepEqual(await verifyAccessToken(token, 1_100, "token-secret"), { userId: "user-1" });
  assert.equal(await verifyAccessToken(`${token}x`, 1_100, "token-secret"), null);
  assert.equal(await verifyAccessToken(token, 1_000 + 30 * 24 * 60 * 60 + 1, "token-secret"), null);
});

test("automatic nickname is stable and contains no openid", () => {
  assert.equal(automaticNickname("user-123"), automaticNickname("user-123"));
  assert.match(automaticNickname("user-123"), /^微信用户 [A-Z0-9]{4}$/);
  assert.doesNotMatch(automaticNickname("user-123"), /user-123/);
});

test("nickname normalization removes angle brackets before trimming and validating", () => {
  assert.equal(wechatAuth.normalizeWechatNickname?.("<   >"), null);
  assert.equal(wechatAuth.normalizeWechatNickname?.("  <小> 明< >  "), "小 明");
});
