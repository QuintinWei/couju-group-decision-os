import { createAccessToken, exchangeWechatCode } from "../../../../lib/wechat-auth";
import { findOrCreateWechatUser } from "../../../../lib/user-store";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: unknown;
  try { body = await request.json(); }
  catch { return Response.json({ error: "请求内容无效" }, { status: 400 }); }
  const code = isRecord(body) && typeof body.code === "string" ? body.code.trim() : "";
  if (!code) return Response.json({ error: "微信登录凭证无效" }, { status: 400 });

  const appId = process.env.WECHAT_APP_ID;
  const appSecret = process.env.WECHAT_APP_SECRET;
  const tokenSecret = process.env.WECHAT_TOKEN_SECRET;
  if (!appId || !appSecret || !tokenSecret) return Response.json({ error: "微信登录服务暂未配置" }, { status: 503 });

  try {
    const { openid } = await exchangeWechatCode(code, { appId, appSecret });
    const user = await findOrCreateWechatUser(openid);
    const accessToken = await createAccessToken(user.id, Math.floor(Date.now() / 1000), tokenSecret);
    return Response.json({ accessToken, user: { id: user.id, nickname: user.nickname } });
  } catch (error) {
    console.error("[auth:wechat]", error);
    return Response.json({ error: "微信登录暂时不可用，请稍后重试" }, { status: 503 });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
