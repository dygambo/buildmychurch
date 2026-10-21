CREATE TABLE "care_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"summary_enc" text,
	"priority" text DEFAULT 'normal' NOT NULL,
	"confidential" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"assigned_to" uuid,
	"assigned_name" text,
	"next_action_on" date,
	"next_action" text,
	"prayer_request_id" uuid,
	"opened_by" uuid,
	"opened_by_name" text,
	"closed_at" timestamp with time zone,
	"closed_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "care_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"case_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"body_enc" text,
	"happened_on" date NOT NULL,
	"amount_kobo" bigint,
	"welfare_kind" text,
	"author_id" uuid,
	"author_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "care_entries_amount_ck" CHECK ("care_entries"."amount_kobo" is null or "care_entries"."amount_kobo" > 0)
);
--> statement-breakpoint
CREATE TABLE "form_responses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"form_id" uuid NOT NULL,
	"answers_enc" text NOT NULL,
	"name" text,
	"contact_hash" text,
	"member_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "forms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"closes_at" timestamp with time zone,
	"max_responses" integer,
	"one_each" boolean DEFAULT false NOT NULL,
	"thank_you" text,
	"notify_email" text,
	"created_by" uuid,
	"created_by_name" text,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prayer_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"branch_id" uuid,
	"member_id" uuid,
	"name" text,
	"phone_enc" text,
	"email_enc" text,
	"body_enc" text NOT NULL,
	"category" text DEFAULT 'other' NOT NULL,
	"confidential" boolean DEFAULT false NOT NULL,
	"wants_contact" boolean DEFAULT false NOT NULL,
	"source" text NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"assigned_to" uuid,
	"assigned_name" text,
	"prayed_count" integer DEFAULT 0 NOT NULL,
	"last_prayed_at" timestamp with time zone,
	"testimony_enc" text,
	"created_by_name" text,
	"closed_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "care_cases_org_idx" ON "care_cases" USING btree ("org_id","status","next_action_on");--> statement-breakpoint
CREATE INDEX "care_cases_member_idx" ON "care_cases" USING btree ("org_id","member_id");--> statement-breakpoint
CREATE INDEX "care_entries_case_idx" ON "care_entries" USING btree ("org_id","case_id","happened_on");--> statement-breakpoint
CREATE INDEX "form_responses_form_idx" ON "form_responses" USING btree ("org_id","form_id","created_at");--> statement-breakpoint
CREATE INDEX "form_responses_contact_idx" ON "form_responses" USING btree ("form_id","contact_hash");--> statement-breakpoint
CREATE INDEX "forms_org_idx" ON "forms" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "prayer_requests_org_idx" ON "prayer_requests" USING btree ("org_id","status","created_at");--> statement-breakpoint
CREATE INDEX "prayer_requests_member_idx" ON "prayer_requests" USING btree ("org_id","member_id");