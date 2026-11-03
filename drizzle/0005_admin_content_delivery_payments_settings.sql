ALTER TABLE `settings` ADD COLUMN `hours_json` TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE `settings` ADD COLUMN `zones_json` TEXT NOT NULL DEFAULT '[]';
--> statement-breakpoint
ALTER TABLE `settings` ADD COLUMN `payments_json` TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE `settings` ADD COLUMN `content_json` TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE `settings` ADD COLUMN `promo_video` TEXT NOT NULL DEFAULT 'main';
--> statement-breakpoint
ALTER TABLE `settings` ADD COLUMN `banners_json` TEXT NOT NULL DEFAULT '[]';
--> statement-breakpoint
ALTER TABLE `settings` ADD COLUMN `loyalty_per_amount` INTEGER NOT NULL DEFAULT 100;
--> statement-breakpoint
ALTER TABLE `settings` ADD COLUMN `loyalty_redeem_points` INTEGER NOT NULL DEFAULT 100;
--> statement-breakpoint
ALTER TABLE `settings` ADD COLUMN `loyalty_redeem_value` INTEGER NOT NULL DEFAULT 20;
