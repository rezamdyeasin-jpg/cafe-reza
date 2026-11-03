ALTER TABLE `products` ADD COLUMN `image_key2` text;
--> statement-breakpoint
ALTER TABLE `products` ADD COLUMN `ingredients` text NOT NULL DEFAULT '';
