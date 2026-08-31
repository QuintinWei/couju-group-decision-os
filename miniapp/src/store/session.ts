import Taro from "@tarojs/taro";

import { membershipStorageKey, normalizeRoomCode, sessionStorageKey } from "../domain/session";
import type { Membership, Session } from "../types/api";

export function loadSession(): Session | null {
  const value = Taro.getStorageSync<unknown>(sessionStorageKey);
  return isSession(value) ? value : null;
}

export function saveSession(session: Session) {
  Taro.setStorageSync(sessionStorageKey, session);
}

export function clearSession() {
  Taro.removeStorageSync(sessionStorageKey);
}

export function loadMembership(roomCode: string): Membership | null {
  const expectedRoomCode = normalizeRoomCode(roomCode);
  if (!/^[A-Z0-9]{6}$/.test(expectedRoomCode)) return null;
  const value = Taro.getStorageSync<unknown>(membershipStorageKey(expectedRoomCode));
  return isMembership(value) && normalizeRoomCode(value.roomCode) === expectedRoomCode
    ? { ...value, roomCode: expectedRoomCode }
    : null;
}

export function saveMembership(membership: Membership) {
  const roomCode = normalizeRoomCode(membership.roomCode);
  if (!/^[A-Z0-9]{6}$/.test(roomCode)) throw new Error("房间号无效");
  Taro.setStorageSync(membershipStorageKey(roomCode), { ...membership, roomCode });
}

export function clearMembership(roomCode: string) {
  const normalizedRoomCode = normalizeRoomCode(roomCode);
  if (/^[A-Z0-9]{6}$/.test(normalizedRoomCode)) Taro.removeStorageSync(membershipStorageKey(normalizedRoomCode));
}

function isSession(value: unknown): value is Session {
  if (!isRecord(value) || !isRecord(value.user)) return false;
  return isNonEmptyString(value.accessToken) && isNonEmptyString(value.user.id) && isNonEmptyString(value.user.nickname);
}

function isMembership(value: unknown): value is Membership {
  return isRecord(value) && isNonEmptyString(value.roomCode) && isNonEmptyString(value.memberId) && isNonEmptyString(value.memberToken);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
