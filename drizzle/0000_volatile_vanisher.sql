CREATE TABLE `assignment` (
	`id` text PRIMARY KEY NOT NULL,
	`shift_id` text NOT NULL,
	`staff_id` text NOT NULL,
	`schedule_id` text NOT NULL,
	`status` text DEFAULT 'assigned' NOT NULL,
	`is_charge_nurse` integer DEFAULT false NOT NULL,
	`is_overtime` integer DEFAULT false NOT NULL,
	`assignment_source` text DEFAULT 'manual' NOT NULL,
	`agency_reason` text,
	`safe_harbor_invoked` integer DEFAULT false NOT NULL,
	`safe_harbor_form_id` text,
	`is_float` integer DEFAULT false NOT NULL,
	`float_from_unit` text,
	`notes` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`shift_id`) REFERENCES `shift`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`staff_id`) REFERENCES `staff`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`schedule_id`) REFERENCES `schedule`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `assignment_shift_idx` ON `assignment` (`shift_id`);--> statement-breakpoint
CREATE INDEX `assignment_staff_idx` ON `assignment` (`staff_id`);--> statement-breakpoint
CREATE INDEX `assignment_schedule_idx` ON `assignment` (`schedule_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `assignment_unique_idx` ON `assignment` (`shift_id`,`staff_id`);--> statement-breakpoint
CREATE TABLE `callout` (
	`id` text PRIMARY KEY NOT NULL,
	`assignment_id` text NOT NULL,
	`staff_id` text NOT NULL,
	`shift_id` text NOT NULL,
	`reason` text NOT NULL,
	`reason_detail` text,
	`called_out_at` text DEFAULT (datetime('now')) NOT NULL,
	`replacement_staff_id` text,
	`replacement_source` text,
	`escalation_steps_taken` text DEFAULT '[]',
	`status` text DEFAULT 'open' NOT NULL,
	`resolved_at` text,
	`resolved_by` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`assignment_id`) REFERENCES `assignment`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`staff_id`) REFERENCES `staff`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`shift_id`) REFERENCES `shift`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`replacement_staff_id`) REFERENCES `staff`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `callout_shift_idx` ON `callout` (`shift_id`);--> statement-breakpoint
CREATE INDEX `callout_staff_idx` ON `callout` (`staff_id`);--> statement-breakpoint
CREATE INDEX `callout_status_idx` ON `callout` (`status`);--> statement-breakpoint
CREATE TABLE `census_band` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`unit` text DEFAULT 'ICU' NOT NULL,
	`min_patients` integer NOT NULL,
	`max_patients` integer NOT NULL,
	`required_rns` integer NOT NULL,
	`required_lpns` integer DEFAULT 0 NOT NULL,
	`required_cnas` integer DEFAULT 0 NOT NULL,
	`required_charge_nurses` integer DEFAULT 1 NOT NULL,
	`patient_to_nurse_ratio` text DEFAULT '2:1' NOT NULL,
	`color` text DEFAULT 'green' NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `census_band_unit_idx` ON `census_band` (`unit`);--> statement-breakpoint
CREATE TABLE `exception_log` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`action` text NOT NULL,
	`description` text NOT NULL,
	`previous_state` text,
	`new_state` text,
	`overridden_rule_id` text,
	`justification` text,
	`performed_by` text DEFAULT 'nurse_manager' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`overridden_rule_id`) REFERENCES `rule`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `exception_log_entity_idx` ON `exception_log` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `exception_log_action_idx` ON `exception_log` (`action`);--> statement-breakpoint
CREATE INDEX `exception_log_date_idx` ON `exception_log` (`created_at`);--> statement-breakpoint
CREATE TABLE `generation_job` (
	`id` text PRIMARY KEY NOT NULL,
	`schedule_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`progress` integer DEFAULT 0 NOT NULL,
	`current_phase` text,
	`started_at` text,
	`completed_at` text,
	`error` text,
	`warnings` text DEFAULT '[]',
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`schedule_id`) REFERENCES `schedule`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `generation_job_schedule_idx` ON `generation_job` (`schedule_id`);--> statement-breakpoint
CREATE INDEX `generation_job_status_idx` ON `generation_job` (`status`);--> statement-breakpoint
CREATE TABLE `open_shift` (
	`id` text PRIMARY KEY NOT NULL,
	`shift_id` text NOT NULL,
	`original_staff_id` text NOT NULL,
	`original_assignment_id` text,
	`reason` text NOT NULL,
	`reason_detail` text,
	`status` text DEFAULT 'pending_approval' NOT NULL,
	`priority` text DEFAULT 'normal' NOT NULL,
	`recommendations` text DEFAULT '[]',
	`escalation_steps_checked` text DEFAULT '[]',
	`selected_staff_id` text,
	`selected_source` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`approved_at` text,
	`approved_by` text,
	`filled_at` text,
	`filled_by_staff_id` text,
	`filled_by_assignment_id` text,
	`notes` text,
	FOREIGN KEY (`shift_id`) REFERENCES `shift`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`original_staff_id`) REFERENCES `staff`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`original_assignment_id`) REFERENCES `assignment`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`selected_staff_id`) REFERENCES `staff`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`filled_by_staff_id`) REFERENCES `staff`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`filled_by_assignment_id`) REFERENCES `assignment`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `open_shift_shift_idx` ON `open_shift` (`shift_id`);--> statement-breakpoint
CREATE INDEX `open_shift_status_idx` ON `open_shift` (`status`);--> statement-breakpoint
CREATE INDEX `open_shift_priority_idx` ON `open_shift` (`priority`);--> statement-breakpoint
CREATE TABLE `prn_availability` (
	`id` text PRIMARY KEY NOT NULL,
	`staff_id` text NOT NULL,
	`schedule_id` text NOT NULL,
	`available_dates` text DEFAULT '[]' NOT NULL,
	`submitted_at` text DEFAULT (datetime('now')) NOT NULL,
	`notes` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`staff_id`) REFERENCES `staff`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`schedule_id`) REFERENCES `schedule`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `prn_availability_staff_idx` ON `prn_availability` (`staff_id`);--> statement-breakpoint
CREATE INDEX `prn_availability_schedule_idx` ON `prn_availability` (`schedule_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `prn_availability_unique_idx` ON `prn_availability` (`staff_id`,`schedule_id`);--> statement-breakpoint
CREATE TABLE `public_holiday` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`date` text NOT NULL,
	`year` integer NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `public_holiday_date_idx` ON `public_holiday` (`date`);--> statement-breakpoint
CREATE INDEX `public_holiday_year_idx` ON `public_holiday` (`year`);--> statement-breakpoint
CREATE TABLE `rule` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`rule_type` text NOT NULL,
	`category` text NOT NULL,
	`description` text,
	`parameters` text NOT NULL,
	`weight` real DEFAULT 1 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `rule_type_idx` ON `rule` (`rule_type`);--> statement-breakpoint
CREATE INDEX `rule_category_idx` ON `rule` (`category`);--> statement-breakpoint
CREATE TABLE `scenario` (
	`id` text PRIMARY KEY NOT NULL,
	`schedule_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`overall_score` real,
	`coverage_score` real,
	`fairness_score` real,
	`cost_score` real,
	`preference_score` real,
	`skill_mix_score` real,
	`assignment_snapshot` text,
	`hard_violations` text DEFAULT '[]',
	`soft_violations` text DEFAULT '[]',
	`status` text DEFAULT 'draft' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`schedule_id`) REFERENCES `schedule`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `scenario_schedule_idx` ON `scenario` (`schedule_id`);--> statement-breakpoint
CREATE TABLE `schedule` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`unit` text DEFAULT 'ICU' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`notes` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`published_at` text
);
--> statement-breakpoint
CREATE INDEX `schedule_status_idx` ON `schedule` (`status`);--> statement-breakpoint
CREATE INDEX `schedule_dates_idx` ON `schedule` (`start_date`,`end_date`);--> statement-breakpoint
CREATE INDEX `schedule_unit_idx` ON `schedule` (`unit`);--> statement-breakpoint
CREATE TABLE `shift` (
	`id` text PRIMARY KEY NOT NULL,
	`schedule_id` text NOT NULL,
	`shift_definition_id` text NOT NULL,
	`date` text NOT NULL,
	`required_staff_count` integer,
	`requires_charge_nurse` integer,
	`actual_census` integer,
	`census_band_id` text,
	`acuity_level` text,
	`acuity_extra_staff` integer DEFAULT 0,
	`sitter_count` integer DEFAULT 0,
	`notes` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`schedule_id`) REFERENCES `schedule`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`shift_definition_id`) REFERENCES `shift_definition`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`census_band_id`) REFERENCES `census_band`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `shift_schedule_idx` ON `shift` (`schedule_id`);--> statement-breakpoint
CREATE INDEX `shift_date_idx` ON `shift` (`date`);--> statement-breakpoint
CREATE UNIQUE INDEX `shift_unique_idx` ON `shift` (`schedule_id`,`shift_definition_id`,`date`);--> statement-breakpoint
CREATE TABLE `shift_definition` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`shift_type` text NOT NULL,
	`start_time` text NOT NULL,
	`end_time` text NOT NULL,
	`duration_hours` real NOT NULL,
	`unit` text DEFAULT 'ICU' NOT NULL,
	`required_staff_count` integer DEFAULT 2 NOT NULL,
	`requires_charge_nurse` integer DEFAULT true NOT NULL,
	`counts_toward_staffing` integer DEFAULT true NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `shift_swap_request` (
	`id` text PRIMARY KEY NOT NULL,
	`requesting_assignment_id` text NOT NULL,
	`requesting_staff_id` text NOT NULL,
	`target_assignment_id` text,
	`target_staff_id` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`requested_at` text DEFAULT (datetime('now')) NOT NULL,
	`reviewed_at` text,
	`reviewed_by` text,
	`denial_reason` text,
	`validation_notes` text,
	`notes` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`requesting_assignment_id`) REFERENCES `assignment`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`requesting_staff_id`) REFERENCES `staff`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`target_assignment_id`) REFERENCES `assignment`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`target_staff_id`) REFERENCES `staff`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `swap_request_requesting_staff_idx` ON `shift_swap_request` (`requesting_staff_id`);--> statement-breakpoint
CREATE INDEX `swap_request_target_staff_idx` ON `shift_swap_request` (`target_staff_id`);--> statement-breakpoint
CREATE INDEX `swap_request_status_idx` ON `shift_swap_request` (`status`);--> statement-breakpoint
CREATE TABLE `staff` (
	`id` text PRIMARY KEY NOT NULL,
	`first_name` text NOT NULL,
	`last_name` text NOT NULL,
	`email` text,
	`phone` text,
	`role` text NOT NULL,
	`employment_type` text NOT NULL,
	`fte` real DEFAULT 1 NOT NULL,
	`hire_date` text NOT NULL,
	`icu_competency_level` integer DEFAULT 1 NOT NULL,
	`is_charge_nurse_qualified` integer DEFAULT false NOT NULL,
	`certifications` text DEFAULT '[]',
	`reliability_rating` integer DEFAULT 3 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`home_unit` text DEFAULT 'ICU',
	`cross_trained_units` text DEFAULT '[]',
	`weekend_exempt` integer DEFAULT false NOT NULL,
	`flex_hours_year_to_date` real DEFAULT 0 NOT NULL,
	`voluntary_flex_available` integer DEFAULT false NOT NULL,
	`notes` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `staff_role_idx` ON `staff` (`role`);--> statement-breakpoint
CREATE INDEX `staff_employment_type_idx` ON `staff` (`employment_type`);--> statement-breakpoint
CREATE INDEX `staff_active_idx` ON `staff` (`is_active`);--> statement-breakpoint
CREATE INDEX `staff_home_unit_idx` ON `staff` (`home_unit`);--> statement-breakpoint
CREATE TABLE `staff_holiday_assignment` (
	`id` text PRIMARY KEY NOT NULL,
	`staff_id` text NOT NULL,
	`holiday_name` text NOT NULL,
	`year` integer NOT NULL,
	`shift_id` text,
	`assignment_id` text,
	`assigned_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`staff_id`) REFERENCES `staff`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`shift_id`) REFERENCES `shift`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`assignment_id`) REFERENCES `assignment`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `staff_holiday_assignment_staff_idx` ON `staff_holiday_assignment` (`staff_id`);--> statement-breakpoint
CREATE INDEX `staff_holiday_assignment_year_idx` ON `staff_holiday_assignment` (`year`);--> statement-breakpoint
CREATE INDEX `staff_holiday_assignment_holiday_idx` ON `staff_holiday_assignment` (`holiday_name`,`year`);--> statement-breakpoint
CREATE UNIQUE INDEX `staff_holiday_assignment_unique_idx` ON `staff_holiday_assignment` (`staff_id`,`holiday_name`,`year`);--> statement-breakpoint
CREATE TABLE `staff_leave` (
	`id` text PRIMARY KEY NOT NULL,
	`staff_id` text NOT NULL,
	`leave_type` text NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`submitted_at` text DEFAULT (datetime('now')) NOT NULL,
	`approved_at` text,
	`approved_by` text,
	`denial_reason` text,
	`reason` text,
	`notes` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`staff_id`) REFERENCES `staff`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `staff_leave_staff_idx` ON `staff_leave` (`staff_id`);--> statement-breakpoint
CREATE INDEX `staff_leave_dates_idx` ON `staff_leave` (`start_date`,`end_date`);--> statement-breakpoint
CREATE INDEX `staff_leave_status_idx` ON `staff_leave` (`status`);--> statement-breakpoint
CREATE TABLE `staff_preferences` (
	`id` text PRIMARY KEY NOT NULL,
	`staff_id` text NOT NULL,
	`preferred_shift` text DEFAULT 'any',
	`max_hours_per_week` integer DEFAULT 40,
	`max_consecutive_days` integer DEFAULT 3,
	`preferred_days_off` text DEFAULT '[]',
	`preferred_pattern` text,
	`avoid_weekends` integer DEFAULT false,
	`notes` text,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`staff_id`) REFERENCES `staff`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `staff_preferences_staff_idx` ON `staff_preferences` (`staff_id`);--> statement-breakpoint
CREATE TABLE `unit` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`weekend_rule_type` text DEFAULT 'count_per_period' NOT NULL,
	`weekend_shifts_required` integer DEFAULT 3 NOT NULL,
	`schedule_period_weeks` integer DEFAULT 6 NOT NULL,
	`holiday_shifts_required` integer DEFAULT 1 NOT NULL,
	`escalation_sequence` text DEFAULT '["float","per_diem","overtime","agency"]',
	`acuity_yellow_extra_staff` integer DEFAULT 1 NOT NULL,
	`acuity_red_extra_staff` integer DEFAULT 2 NOT NULL,
	`low_census_order` text DEFAULT '["voluntary","overtime","per_diem","full_time"]',
	`callout_threshold_days` integer DEFAULT 7 NOT NULL,
	`ot_approval_threshold` integer DEFAULT 4 NOT NULL,
	`max_on_call_per_week` integer DEFAULT 1 NOT NULL,
	`max_on_call_weekends_per_month` integer DEFAULT 1 NOT NULL,
	`max_consecutive_weekends` integer DEFAULT 2 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `unit_name_idx` ON `unit` (`name`);