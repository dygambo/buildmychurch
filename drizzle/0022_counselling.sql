CREATE TABLE "counselling_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"ref_no" text NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'enquiry' NOT NULL,
	"source" text NOT NULL,
	"a_member_id" uuid,
	"a_name" text NOT NULL,
	"a_phone_enc" text,
	"a_email_enc" text,
	"b_member_id" uuid,
	"b_name" text NOT NULL,
	"b_phone_enc" text,
	"b_email_enc" text,
	"wedding_date" date,
	"wedding_venue" text,
	"married_since" date,
	"reason_enc" text,
	"counsellor_ids" uuid[] DEFAULT '{}' NOT NULL,
	"checklist" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"planned_sessions" integer DEFAULT 8 NOT NULL,
	"summary_enc" text,
	"outcome" text,
	"certificate_no" text,
	"completed_at" timestamp with time zone,
	"created_by" uuid,
	"created_by_name" text,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "counselling_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"case_id" uuid NOT NULL,
	"topic" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"duration_min" integer DEFAULT 60 NOT NULL,
	"location" text,
	"counsellor_id" uuid,
	"counsellor_name" text,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"notes_enc" text,
	"homework" text,
	"attended" text,
	"reminded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "counselling_cases_org_idx" ON "counselling_cases" USING btree ("org_id","status","created_at");--> statement-breakpoint
CREATE INDEX "counselling_sessions_case_idx" ON "counselling_sessions" USING btree ("org_id","case_id","starts_at");--> statement-breakpoint
CREATE INDEX "counselling_sessions_time_idx" ON "counselling_sessions" USING btree ("org_id","starts_at");