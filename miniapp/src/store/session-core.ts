import { membershipStorageKey, normalizeRoomCode, sessionStorageKey } from "../domain/session.ts";
import type { Membership, Session } from "../types/api.ts";

export type TaroStorage = {
  getStorageSync<T = unknown>(key: string): T;
  setStorageSync(key: string, value: unknown): void;
  removeStorageSync(key: string): void;
};

export type SessionStore = {
  loadSession(): Session | null;
  saveSession(session: Session): void;
  clearSession(): void;
  loadMembership(roomCode: string): Membership | null;
  saveMembership(membership: Membership): void;
  clearMembership(roomCode: string): void;
};

export function createSessionStore(storage: TaroStorage): SessionStore {
  return {
    loadSession() {
      const value = storage.getStorageSync<unknown>(sessionStorageKey);
      return isSession(value) ? value : null;
    },
    saveSession(session) {
      storage.setStorageSync(sessionStorageKey, session);
    },
    clearSession() {
      storage.removeStorageSync(sessionStorageKey);
    },
    loadMembership(roomCode) {
      const expectedRoomCode = normalizeRoomCode(roomCode);
      if (!/^[A-Z0-9]{6}$/.test(expectedRoomCode)) return null;
      const value = storage.getStorageSync<unknown>(membershipStorageKey(expectedRoomCode));
      return isMembership(value) && normalizeRoomCode(value.roomCode) === expectedRoomCode
        ? { ...value, roomCode: expectedRoomCode }
        : null;
    },
    saveMembership(membership) {
      const roomCode = normalizeRoomCode(membership.roomCode);
      if (!/^[A-Z0-9]{6}$/.test(roomCode)) throw new Error("房间号无效");
      storage.setStorageSync(membershipStorageKey(roomCode), { ...membership, roomCode });
    },
    clearMembership(roomCode) {
      const normalizedRoomCode = normalizeRoomCode(roomCode);
      if (/^[A-Z0-9]{6}$/.test(normalizedRoomCode)) storage.removeStorageSync(membershipStorageKey(normalizedRoomCode));
    },
  };
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
