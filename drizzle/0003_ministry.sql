CREATE TABLE "attendance" (
	"org_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"method" text NOT NULL,
	"checked_in_at" timestamp with time zone DEFAULT now() NOT NULL,
	"checked_in_by" uuid,
	CONSTRAINT "attendance_service_id_member_id_pk" PRIMARY KEY("service_id","member_id")
);
--> statement-breakpoint
CREATE TABLE "child_checkins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"child_id" uuid NOT NULL,
	"service_id" uuid,
	"class_group" text,
	"security_code" text NOT NULL,
	"checked_in_at" timestamp with time zone DEFAULT now() NOT NULL,
	"checked_in_by" uuid NOT NULL,
	"checked_in_by_name" text NOT NULL,
	"dropped_off_by" uuid,
	"check_in_method" text NOT NULL,
	"checked_out_at" timestamp with time zone,
	"checked_out_by" uuid,
	"checked_out_by_name" text,
	"picked_up_by" uuid,
	"check_out_method" text,
	"override_reason" text
);
--> statement-breakpoint
CREATE TABLE "child_events" (
	"seq" bigserial PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"child_id" uuid NOT NULL,
	"checkin_id" uuid NOT NULL,
	"type" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"data" jsonb NOT NULL,
	"prev_hash" text NOT NULL,
	"hash" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "child_guardians" (
	"org_id" uuid NOT NULL,
	"child_id" uuid NOT NULL,
	"guardian_id" uuid NOT NULL,
	"relationship" text NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"can_pick_up" boolean DEFAULT true NOT NULL,
	"notify" boolean DEFAULT true NOT NULL,
	CONSTRAINT "child_guardians_child_id_guardian_id_pk" PRIMARY KEY("child_id","guardian_id")
);
--> statement-breakpoint
CREATE TABLE "children" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"child_no" text NOT NULL,
	"first_name" text NOT NULL,
	"middle_name" text,
	"last_name" text NOT NULL,
	"gender" text NOT NULL,
	"dob" date NOT NULL,
	"class_group" text,
	"allergies_enc" text,
	"medical_enc" text,
	"special_needs_enc" text,
	"notes" text,
	"photo_consent" boolean DEFAULT false NOT NULL,
	"qr_token" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "followup_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"followup_id" uuid NOT NULL,
	"method" text NOT NULL,
	"outcome" text,
	"body_enc" text,
	"author_id" uuid,
	"author_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "followups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"stage" text DEFAULT 'new' NOT NULL,
	"assigned_to" uuid,
	"due_at" timestamp with time zone,
	"prayer_request_enc" text,
	"wants_visit" boolean DEFAULT false NOT NULL,
	"closed_reason" text,
	"last_contact_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "guardians" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"member_id" uuid,
	"title" text,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"phone_enc" text,
	"phone_hash" text,
	"email_enc" text,
	"email_hash" text,
	"address_enc" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "public_links" (
	"token" text PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"target_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "service_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'sunday' NOT NULL,
	"weekday" smallint NOT NULL,
	"start_time" time NOT NULL,
	"duration_min" integer DEFAULT 120 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"template_id" uuid,
	"name" text NOT NULL,
	"kind" text DEFAULT 'sunday' NOT NULL,
	"date" date NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"men" integer,
	"women" integer,
	"children" integer,
	"online" integer,
	"first_timers_count" integer,
	"count_notes" text,
	"counted_by" uuid,
	"counted_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "attendance_member_idx" ON "attendance" USING btree ("org_id","member_id");--> statement-breakpoint
CREATE INDEX "child_checkins_child_idx" ON "child_checkins" USING btree ("org_id","child_id","checked_in_at");--> statement-breakpoint
CREATE UNIQUE INDEX "child_checkins_open_uq" ON "child_checkins" USING btree ("child_id") WHERE "child_checkins"."checked_out_at" is null;--> statement-breakpoint
CREATE INDEX "child_events_org_seq_idx" ON "child_events" USING btree ("org_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "children_qr_uq" ON "children" USING btree ("qr_token");--> statement-breakpoint
CREATE UNIQUE INDEX "children_org_no_uq" ON "children" USING btree ("org_id","child_no");--> statement-breakpoint
CREATE INDEX "children_name_trgm_idx" ON "children" USING gin ((lower("first_name" || ' ' || "last_name")) gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "followup_notes_fu_idx" ON "followup_notes" USING btree ("followup_id");--> statement-breakpoint
CREATE INDEX "followups_org_stage_idx" ON "followups" USING btree ("org_id","stage");--> statement-breakpoint
CREATE INDEX "followups_member_idx" ON "followups" USING btree ("org_id","member_id");--> statement-breakpoint
CREATE INDEX "guardians_phone_idx" ON "guardians" USING btree ("org_id","phone_hash");--> statement-breakpoint
CREATE INDEX "services_org_date_idx" ON "services" USING btree ("org_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "services_template_date_uq" ON "services" USING btree ("template_id","date");