CREATE TABLE "schedule_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"schedule_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"member_id" uuid,
	"user_id" uuid,
	"group_id" uuid,
	"name" text NOT NULL,
	"responsibility" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "schedule_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"schedule_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"title" text NOT NULL,
	"start_time" text,
	"duration_min" integer,
	"description" text,
	"notes" text,
	"custom" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "schedule_items_duration_ck" CHECK ("schedule_items"."duration_min" is null or ("schedule_items"."duration_min" > 0 and "schedule_items"."duration_min" <= 720))
);
--> statement-breakpoint
CREATE TABLE "schedule_notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"schedule_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"recipient_key" text NOT NULL,
	"recipient_name" text NOT NULL,
	"reason" text NOT NULL,
	"detail" text,
	"channel" text,
	"to_masked" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"message_id" uuid,
	"error" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"sent_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "schedule_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"service_type" text NOT NULL,
	"body" jsonb NOT NULL,
	"created_by" uuid,
	"created_by_name" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "schedule_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"schedule_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"change_summary" text,
	"note" text,
	"published_by" uuid,
	"published_by_name" text NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	"file_id" uuid,
	"pdf_status" text DEFAULT 'pending' NOT NULL,
	"pdf_error" text
);
--> statement-breakpoint
CREATE TABLE "service_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"title" text NOT NULL,
	"service_type" text NOT NULL,
	"type_label" text,
	"service_date" date NOT NULL,
	"start_time" text NOT NULL,
	"end_time" text,
	"venue" text,
	"theme" text,
	"scripture" text,
	"presiding_name" text,
	"presiding_member_id" uuid,
	"announcements" text,
	"internal_notes" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"current_version" integer DEFAULT 0 NOT NULL,
	"has_changes" boolean DEFAULT false NOT NULL,
	"service_id" uuid,
	"created_by" uuid,
	"created_by_name" text NOT NULL,
	"updated_by" uuid,
	"updated_by_name" text,
	"first_published_at" timestamp with time zone,
	"last_published_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "schedule_assignments_schedule_idx" ON "schedule_assignments" USING btree ("schedule_id");--> statement-breakpoint
CREATE INDEX "schedule_assignments_member_idx" ON "schedule_assignments" USING btree ("org_id","member_id");--> statement-breakpoint
CREATE INDEX "schedule_items_schedule_idx" ON "schedule_items" USING btree ("schedule_id","position");--> statement-breakpoint
CREATE INDEX "schedule_notifications_schedule_idx" ON "schedule_notifications" USING btree ("schedule_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "schedule_versions_uq" ON "schedule_versions" USING btree ("schedule_id","version");--> statement-breakpoint
CREATE INDEX "service_schedules_org_date_idx" ON "service_schedules" USING btree ("org_id","service_date");--> statement-breakpoint
CREATE INDEX "service_schedules_org_status_idx" ON "service_schedules" USING btree ("org_id","status");