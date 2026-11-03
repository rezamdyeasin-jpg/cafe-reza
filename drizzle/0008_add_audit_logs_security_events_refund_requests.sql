CREATE TABLE `audit_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`actor_id` integer,
	`actor_name` text NOT NULL DEFAULT '',
	`action` text NOT NULL,
	`target_type` text NOT NULL DEFAULT '',
	`target_id` integer,
	`detail` text NOT NULL DEFAULT '',
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `security_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer,
	`email` text NOT NULL DEFAULT '',
	`kind` text NOT NULL,
	`detail` text NOT NULL DEFAULT '',
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `refund_requests` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`order_id` integer NOT NULL,
	`order_no` text NOT NULL,
	`amount` integer NOT NULL,
	`reason` text NOT NULL DEFAULT '',
	`requested_by` integer NOT NULL,
	`requested_by_name` text NOT NULL DEFAULT '',
	`status` text NOT NULL DEFAULT 'pending',
	`decided_by` integer,
	`decided_by_name` text NOT NULL DEFAULT '',
	`created_at` integer NOT NULL,
	`decided_at` integer
);
--> statement-breakpoint
CREATE INDEX `audit_logs_created_idx` ON `audit_logs` (`created_at`);
--> statement-breakpoint
CREATE INDEX `security_events_created_idx` ON `security_events` (`created_at`);
