type MemberCountRow = { total?: number | string | null; submitted?: number | string | null };

export type MemberCountDatabase = {
  prepare(statement: string): {
    bind(...values: unknown[]): {
      first<T = MemberCountRow>(): Promise<T | null>;
    };
  };
};

/**
 * Last read immediately before the conditional round update. This catches a
 * member that joined or lost a submission while candidates were being built.
 */
export async function hasSubmittedMembersAtAdvanceBoundary(db: MemberCountDatabase, roomCode: string) {
  const counts = await db.prepare(
    "SELECT COUNT(*) AS total, SUM(CASE WHEN submitted_at IS NOT NULL THEN 1 ELSE 0 END) AS submitted FROM members WHERE room_code = ?",
  ).bind(roomCode).first<MemberCountRow>();
  const total = Number(counts?.total ?? 0);
  const submitted = Number(counts?.submitted ?? 0);
  return total > 0 && total === submitted;
}
