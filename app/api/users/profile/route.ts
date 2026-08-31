import { authenticateRequestUser } from "../../../../lib/request-user";
import { updateWechatNickname } from "../../../../lib/user-store";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await authenticateRequestUser(request);
  if (!user) return Response.json({ error: "登录状态已失效" }, { status: 401 });
  return Response.json({ user: { id: user.id, nickname: user.nickname } });
}

export async function PATCH(request: Request) {
  const user = await authenticateRequestUser(request);
  if (!user) return Response.json({ error: "登录状态已失效" }, { status: 401 });
  let body: unknown;
  try { body = await request.json(); }
  catch { return Response.json({ error: "请求内容无效" }, { status: 400 }); }
  if (!isNicknamePatch(body)) return Response.json({ error: "昵称无效" }, { status: 400 });

  try {
    const updated = await updateWechatNickname(user.id, body.nickname);
    if (!updated) return Response.json({ error: "登录状态已失效" }, { status: 401 });
    return Response.json({ user: { id: updated.id, nickname: updated.nickname } });
  } catch (error) {
    if (error instanceof Error && error.message === "INVALID_NICKNAME") return Response.json({ error: "昵称需为 1–18 个字符" }, { status: 400 });
    console.error("[users:profile]", error);
    return Response.json({ error: "昵称更新失败，请稍后重试" }, { status: 503 });
  }
}

function isNicknamePatch(body: unknown): body is { nickname: string } {
  return Boolean(body) && typeof body === "object" && !Array.isArray(body)
    && Object.keys(body).length === 1 && typeof (body as { nickname?: unknown }).nickname === "string";
}
