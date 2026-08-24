import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const rooms = sqliteTable("rooms", {
  code: text("code").primaryKey(),
  city: text("city").notNull(),
  kind: text("kind").notNull(),
  date: text("date").notNull(),
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
});

export const members = sqliteTable("members", {
  id: text("id").primaryKey(),
  roomCode: text("room_code").notNull().references(() => rooms.code, { onDelete: "cascade" }),
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
  submittedAt: text("submitted_at"),
  availabilityJson: text("availability_json"),
  refreshRequestRound: integer("refresh_request_round"),
  privateCandidatesJson: text("private_candidates_json"),
  nominatedCandidateJson: text("nominated_candidate_json"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  index("members_room_code_idx").on(table.roomCode),
]);
