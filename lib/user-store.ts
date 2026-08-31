import { getD1 } from "../db";
import { automaticNickname, normalizeWechatNickname } from "./wechat-auth";

export type WechatUser = {
  id: string;
  openid: string;
  nickname: string;
  createdAt: string;
  updatedAt: string;
};

type WechatUserRow = {
  id: string;
  openid: string;
  nickname: string;
  created_at: string;
  updated_at: string;
};

function toWechatUser(row: WechatUserRow): WechatUser {
  return { id: row.id, openid: row.openid, nickname: row.nickname, createdAt: row.created_at, updatedAt: row.updated_at };
}

export async function findOrCreateWechatUser(openid: string): Promise<WechatUser> {
  const normalizedOpenid = openid.trim();
  if (!normalizedOpenid) throw new Error("INVALID_WECHAT_OPENID");
  const db = getD1();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.prepare("INSERT INTO users (id, openid, nickname, created_at, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(openid) DO NOTHING")
    .bind(id, normalizedOpenid, automaticNickname(id), now, now)
    .run();
  const row = await db.prepare("SELECT id, openid, nickname, created_at, updated_at FROM users WHERE openid = ? LIMIT 1")
    .bind(normalizedOpenid)
    .first<WechatUserRow>();
  if (!row) throw new Error("WECHAT_USER_NOT_FOUND");
  return toWechatUser(row);
}

export async function findWechatUserById(id: string): Promise<WechatUser | null> {
  const row = await getD1().prepare("SELECT id, openid, nickname, created_at, updated_at FROM users WHERE id = ? LIMIT 1")
    .bind(id)
    .first<WechatUserRow>();
  return row ? toWechatUser(row) : null;
}

export async function updateWechatNickname(userId: string, value: string): Promise<WechatUser | null> {
  const nickname = normalizeWechatNickname(value);
  if (!nickname) throw new Error("INVALID_NICKNAME");
  const now = new Date().toISOString();
  await getD1().prepare("UPDATE users SET nickname = ?, updated_at = ? WHERE id = ?")
    .bind(nickname, now, userId)
    .run();
  return findWechatUserById(userId);
}
