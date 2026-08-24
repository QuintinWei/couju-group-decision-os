DELETE FROM `members`;--> statement-breakpoint
DELETE FROM `rooms`;--> statement-breakpoint
ALTER TABLE `members` ADD `availability_json` text;--> statement-breakpoint
ALTER TABLE `rooms` ADD `schedule_config_json` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `rooms` ADD `resolved_schedule_json` text;
