import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const rooms = sqliteTable("rooms", {
  code: text("code").primaryKey(),
  city: text("city").notNull(),
  kind: text("kind").notNull(),
  date: text("date").notNull(),
  /** Legacy: always written empty. The authoritative window lives in resolvedScheduleJson. */
  startTime: text("start_time").notNull(),
  endTime: text("end_time").notNull(),
  scheduleConfigJson: text("schedule_config_json").notNull().default("{}"),
  resolvedScheduleJson: text("resolved_schedule_json"),
  targetPeople: integer("target_people").notNull(),
  candidatesJson: text("candidates_json").notNull(),
  candidateMetaJson: text("candidate_meta_json").notNull(),
  currentRound: integer("current_round").notNull().default(1),
  roundHistoryJson: text("round_history_json").notNull().default("[]"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  index("rooms_updated_at_idx").on(table.updatedAt),
]);

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  openid: text("openid").notNull().unique(),
  nickname: text("nickname").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const members = sqliteTable("members", {
  id: text("id").primaryKey(),
  roomCode: text("room_code").notNull().references(() => rooms.code, { onDelete: "cascade" }),
  userId: text("user_id").references(() => users.id),
  tokenHash: text("token_hash").notNull(),
  name: text("name").notNull(),
  origin: text("origin").notNull(),
  originLng: real("origin_lng"),
  originLat: real("origin_lat"),
  budgetLabel: text("budget_label"),
  commuteLabel: text("commute_label"),
  setting: text("setting"),
  note: text("note"),
  extractionJson: text("extraction_json"),
  choicesJson: text("choices_json"),
  rejectionReasonsJson: text("rejection_reasons_json"),
  submittedAt: text("submitted_at"),
  availabilityJson: text("availability_json"),
  refreshRequestRound: integer("refresh_request_round"),
  privateCandidatesJson: text("private_candidates_json"),
  nominatedCandidateJson: text("nominated_candidate_json"),
  privateDecisionRound: integer("private_decision_round"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  index("members_room_code_idx").on(table.roomCode),
  index("members_user_id_idx").on(table.userId),
  uniqueIndex("members_room_user_id_unique").on(table.roomCode, table.userId),
]);
