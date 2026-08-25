CREATE INDEX `rooms_updated_at_idx` ON `rooms` (`updated_at`);--> statement-breakpoint
ALTER TABLE `rooms` DROP COLUMN `start_time`;--> statement-breakpoint
ALTER TABLE `rooms` DROP COLUMN `end_time`;