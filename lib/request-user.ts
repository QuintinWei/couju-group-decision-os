import { findWechatUserById, type WechatUser } from "./user-store";
import { verifyAccessToken } from "./wechat-auth";

export async function authenticateRequestUser(request: Request): Promise<WechatUser | null> {
  const authorization = request.headers.get("Authorization");
  const match = authorization?.match(/^Bearer ([^\s]+)$/);
  const secret = process.env.WECHAT_TOKEN_SECRET;
  if (!match || !secret) return null;
  const payload = await verifyAccessToken(match[1], Math.floor(Date.now() / 1000), secret);
  return payload ? findWechatUserById(payload.userId) : null;
}
