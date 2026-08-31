import Taro from "@tarojs/taro";

import { clearMembership, clearSession, loadSession } from "../store/session";
import type { Membership } from "../types/api";

const REQUEST_TIMEOUT = 12_000;

export type ApiRequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  data?: Record<string, unknown>;
  header?: Record<string, string>;
  membership?: Membership | null;
};

export class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

export async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const session = loadSession();
  const membership = options.membership ?? null;
  const response = await Taro.request<unknown>({
    url: apiUrl(path),
    method: options.method ?? "GET",
    data: withMembership(options.data, membership),
    timeout: REQUEST_TIMEOUT,
    header: {
      Accept: "application/json",
      ...(options.data ? { "Content-Type": "application/json" } : {}),
      ...(session ? { Authorization: `Bearer ${session.accessToken}` } : {}),
      ...options.header,
    },
  });

  if (response.statusCode < 200 || response.statusCode >= 300) {
    if (response.statusCode === 401) clearSession();
    if (response.statusCode === 403 && membership) clearMembership(membership.roomCode);
    throw new ApiError(response.statusCode, responseMessage(response.data));
  }

  return response.data as T;
}

function apiUrl(path: string) {
  const base = (process.env.TARO_APP_API_BASE ?? "").replace(/\/+$/, "");
  if (!path.startsWith("/")) throw new Error("API 路径必须以 / 开头");
  return `${base}${path}`;
}

function withMembership(data: Record<string, unknown> | undefined, membership: Membership | null) {
  if (!membership) return data;
  return {
    ...data,
    roomCode: data?.roomCode ?? membership.roomCode,
    memberId: membership.memberId,
    token: membership.memberToken,
  };
}

function responseMessage(data: unknown) {
  if (data && typeof data === "object" && "error" in data && typeof data.error === "string") return data.error;
  if (typeof data === "string" && data.trim()) return data;
  return "请求失败，请稍后重试";
}
