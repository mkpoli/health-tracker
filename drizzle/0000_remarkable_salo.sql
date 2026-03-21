CREATE TABLE `patient` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`agab` text,
	`birthday` text,
	`extra_data` text
);
--> statement-breakpoint
CREATE TABLE `record` (
	`id` text PRIMARY KEY NOT NULL,
	`patient_id` text NOT NULL,
	`report_id` text NOT NULL,
	`metric_name` text NOT NULL,
	`value` text NOT NULL,
	`unit` text,
	`ref_range` text,
	`status` text,
	`extra_data` text,
	FOREIGN KEY (`patient_id`) REFERENCES `patient`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`report_id`) REFERENCES `report`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `report` (
	`id` text PRIMARY KEY NOT NULL,
	`patient_id` text NOT NULL,
	`test_date` text NOT NULL,
	`report_time` text,
	`raw_data` text,
	`organized_data` text,
	`parsed_json_data` text,
	`extra_data` text,
	FOREIGN KEY (`patient_id`) REFERENCES `patient`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `task` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`priority` integer DEFAULT 1 NOT NULL
);
