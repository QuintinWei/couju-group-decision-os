ALTER TABLE `members` ADD `refresh_request_round` integer;--> statement-breakpoint
ALTER TABLE `members` ADD `private_candidates_json` text;--> statement-breakpoint
ALTER TABLE `members` ADD `nominated_candidate_json` text;--> statement-breakpoint
ALTER TABLE `rooms` ADD `current_round` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `rooms` ADD `round_history_json` text DEFAULT '[]' NOT NULL;