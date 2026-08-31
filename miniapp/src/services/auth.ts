import Taro from "@tarojs/taro";

import { saveSession } from "../store/session";
import type { Session } from "../types/api";
import { apiRequest } from "./request";

export async function loginWithWechat(): Promise<Session> {
  const login = await Taro.login();
  const code = login.code?.trim();
  if (!code) throw new Error("未能获取微信登录凭证");

  const session = await apiRequest<Session>("/api/auth/wechat", {
    method: "POST",
    data: { code },
  });
  if (!isSession(session)) throw new Error("微信登录返回无效");
  saveSession(session);
  return session;
}

function isSession(value: unknown): value is Session {
  if (!value || typeof value !== "object" || !("accessToken" in value) || !("user" in value)) return false;
  const user = value.user;
  if (!user || typeof user !== "object" || !("id" in user) || !("nickname" in user)) return false;
  return typeof value.accessToken === "string" && value.accessToken.trim().length > 0
    && typeof user.id === "string" && user.id.trim().length > 0
    && typeof user.nickname === "string" && user.nickname.trim().length > 0;
}
