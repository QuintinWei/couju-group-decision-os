import type { Session } from "../types/api";

type ProfileRequest = <T>(
  path: string,
  options: { method: "PATCH"; data: { nickname: string } },
) => Promise<T>;

type ProfileServiceDependencies = {
  request: ProfileRequest;
  loadSession: () => Session | null;
  saveSession: (session: Session) => void;
};

export function createProfileService({ request, loadSession, saveSession }: ProfileServiceDependencies) {
  return {
    async updateNickname(nickname: string) {
      const current = loadSession();
      if (!current) throw new Error("微信登录状态不可用，请重新进入小程序");

      const response = await request<unknown>("/api/users/profile", {
        method: "PATCH",
        data: { nickname },
      });
      if (!isProfileResponse(response) || response.user.id !== current.user.id) {
        throw new Error("昵称更新响应无效，请稍后重试");
      }

      saveSession({ ...current, user: response.user });
      return response.user;
    },
  };
}

function isProfileResponse(value: unknown): value is { user: Session["user"] } {
  if (!value || typeof value !== "object" || !("user" in value)) return false;
  const user = value.user;
  if (!user || typeof user !== "object") return false;
  return "id" in user && typeof user.id === "string" && user.id.trim().length > 0
    && "nickname" in user && typeof user.nickname === "string" && user.nickname.trim().length > 0;
}
