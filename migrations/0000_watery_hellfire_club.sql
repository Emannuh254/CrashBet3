CREATE TABLE `bets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`player_index` integer DEFAULT 0 NOT NULL,
	`round_id` integer NOT NULL,
	`amount` integer NOT NULL,
	`cashout_multiplier` real,
	`auto_cashout` real,
	`win_amount` integer,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `rounds` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`crash_point` real NOT NULL,
	`server_seed` text NOT NULL,
	`client_seed` text NOT NULL,
	`nonce` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`start_time` integer DEFAULT 0 NOT NULL,
	`end_time` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `slots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`player_index` integer NOT NULL,
	`balance` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`username` text NOT NULL,
	`password` text NOT NULL,
	`is_admin` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);