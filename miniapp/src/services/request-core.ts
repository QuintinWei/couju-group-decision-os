import type { SessionStore } from "../store/session-core";
import type { Membership } from "../types/api";

export const requestTimeout = 12_000;

export type ApiRequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  data?: Record<string, unknown>;
  header?: Record<string, string>;
  membership?: Membership | null;
  timeout?: number;
};

export type TaroRequestOptions = {
  url: string;
  method: NonNullable<ApiRequestOptions["method"]>;
  data?: Record<string, unknown>;
  timeout: number;
  header: Record<string, string>;
};

export type TaroRequest = (options: TaroRequestOptions) => Promise<{ statusCode: number; data: unknown }>;

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export function createApiRequest({ apiBase, request, store }: { apiBase: string | undefined; request: TaroRequest; store: SessionStore }) {
  return async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
    const session = store.loadSession();
    const membership = options.membership ?? null;
    const response = await request({
      url: apiUrl(apiBase, path),
      method: options.method ?? "GET",
      data: withMembership(options.data, membership),
      timeout: options.timeout ?? requestTimeout,
      header: {
        Accept: "application/json",
        ...(options.data ? { "Content-Type": "application/json" } : {}),
        ...(session ? { Authorization: `Bearer ${session.accessToken}` } : {}),
        ...options.header,
      },
    });

    if (response.statusCode < 200 || response.statusCode >= 300) {
      if (response.statusCode === 401) store.clearSession();
      if (response.statusCode === 403 && membership) store.clearMembership(membership.roomCode);
      throw new ApiError(response.statusCode, responseMessage(response.data));
    }

    return response.data as T;
  };
}

function apiUrl(apiBase: string | undefined, path: string) {
  if (!path.startsWith("/")) throw new Error("API 路径必须以 / 开头");
  const base = apiBase?.trim().replace(/\/+$/, "") ?? "";
  if (!base) throw new Error("请配置 TARO_APP_API_BASE 后重新构建小程序");
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
