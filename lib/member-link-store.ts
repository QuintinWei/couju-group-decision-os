type BoundMemberLinkStatement = {
  first<T>(): Promise<T | null>;
  run(): Promise<{ meta: { changes?: number } }>;
};

export type MemberLinkDatabase = {
  prepare(query: string): {
    bind(...values: unknown[]): BoundMemberLinkStatement;
  };
};

export type IssuedMemberToken = {
  memberToken: string;
  tokenHash: string;
};

export type MemberInsertInput = IssuedMemberToken & {
  id: string;
  roomCode: string;
  userId?: string | null;
  name: string;
  origin: string;
  originLocation: { lng: number; lat: number } | null;
  now: string;
};

export type RestoredMemberIdentity = {
  memberId: string;
  memberToken: string;
};

export type MemberInsertResolution =
  | { kind: "inserted" }
  | { kind: "restored"; identity: RestoredMemberIdentity }
  | { kind: "rejected" };

const INSERT_STORED_MEMBER_SQL = "INSERT INTO members (id, room_code, user_id, token_hash, name, origin, origin_lng, origin_lat, created_at, updated_at) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM members WHERE room_code = ?) < (SELECT target_people FROM rooms WHERE code = ?) ON CONFLICT DO NOTHING";

export async function insertStoredMember(db: MemberLinkDatabase, input: MemberInsertInput): Promise<MemberInsertResolution> {
  const inserted = await db.prepare(INSERT_STORED_MEMBER_SQL)
    .bind(input.id, input.roomCode, input.userId ?? null, input.tokenHash, input.name, input.origin, input.originLocation?.lng ?? null, input.originLocation?.lat ?? null, input.now, input.now, input.roomCode, input.roomCode)
    .run();
  if ((inserted.meta.changes ?? 0) >= 1) return { kind: "inserted" };
  if (input.userId) {
    const identity = await restoreLinkedMembership(db, input.roomCode, input.userId, input);
    if (identity) return { kind: "restored", identity };
  }
  return { kind: "rejected" };
}

export async function restoreLinkedMembership(db: MemberLinkDatabase, roomCode: string, userId: string, token: IssuedMemberToken): Promise<RestoredMemberIdentity | null> {
  const member = await db.prepare("SELECT id FROM members WHERE room_code = ? AND user_id = ? LIMIT 1")
    .bind(roomCode, userId).first<{ id: string }>();
  if (!member) return null;
  const updated = await db.prepare("UPDATE members SET token_hash = ? WHERE id = ? AND room_code = ? AND user_id = ?")
    .bind(token.tokenHash, member.id, roomCode, userId).run();
  return (updated.meta.changes ?? 0) === 1 ? { memberId: member.id, memberToken: token.memberToken } : null;
}
