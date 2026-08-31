CREATE TABLE `users` (
  `id` text PRIMARY KEY NOT NULL,
  `openid` text NOT NULL,
  `nickname` text NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_openid_unique` ON `users` (`openid`);
--> statement-breakpoint
ALTER TABLE `members` ADD `user_id` text REFERENCES users(`id`);
--> statement-breakpoint
CREATE INDEX `members_user_id_idx` ON `members` (`user_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `members_room_user_id_unique` ON `members` (`room_code`,`user_id`);
