CREATE TABLE `members` (
	`id` text PRIMARY KEY NOT NULL,
	`room_code` text NOT NULL,
	`token_hash` text NOT NULL,
	`name` text NOT NULL,
	`origin` text NOT NULL,
	`budget_label` text,
	`commute_label` text,
	`setting` text,
	`note` text,
	`extraction_json` text,
	`choices_json` text,
	`submitted_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`room_code`) REFERENCES `rooms`(`code`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `members_room_code_idx` ON `members` (`room_code`);--> statement-breakpoint
CREATE TABLE `rooms` (
	`code` text PRIMARY KEY NOT NULL,
	`city` text NOT NULL,
	`kind` text NOT NULL,
	`date` text NOT NULL,
	`start_time` text NOT NULL,
	`end_time` text NOT NULL,
	`target_people` integer NOT NULL,
	`candidates_json` text NOT NULL,
	`candidate_meta_json` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
