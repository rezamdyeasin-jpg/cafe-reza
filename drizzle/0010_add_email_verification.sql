ALTER TABLE `users` ADD COLUMN `email_verified` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
CREATE TABLE `email_verifications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`email` text NOT NULL,
	`code_hash` text NOT NULL,
	`salt` text NOT NULL,
	`attempts` integer NOT NULL DEFAULT 0,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `email_verifications_email_idx` ON `email_verifications` (`email`);
