export const sessionStorageKey = "couju:session";

export function normalizeRoomCode(value: unknown) {
  return typeof value === "string" ? value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "") : "";
}

export function membershipStorageKey(roomCode: string) {
  return `couju:membership:${normalizeRoomCode(roomCode)}`;
}

export function resolveLaunchRoom(query: Record<string, unknown> | null | undefined) {
  const roomCode = normalizeRoomCode(query?.room);
  return /^[A-Z0-9]{6}$/.test(roomCode) ? roomCode : null;
}
