CREATE TABLE "memo_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"memo_id" uuid NOT NULL,
	"author_id" uuid,
	"author_name" text NOT NULL,
	"kind" text NOT NULL,
	"body" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memo_route_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"label" text NOT NULL,
	"role_key" text,
	"user_id" uuid,
	"min_amount_kobo" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memo_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"memo_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"label" text NOT NULL,
	"role_key" text,
	"user_id" uuid,
	"status" text DEFAULT 'waiting' NOT NULL,
	"opened_at" timestamp with time zone,
	"acted_by" uuid,
	"acted_by_name" text,
	"acted_at" timestamp with time zone,
	"comment" text,
	"stamp" jsonb
);
--> statement-breakpoint
CREATE TABLE "memo_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"needs_amount" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memo_views" (
	"org_id" uuid NOT NULL,
	"memo_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"user_name" text NOT NULL,
	"first_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_at" timestamp with time zone DEFAULT now() NOT NULL,
	"count" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"ref_no" text,
	"template_id" uuid,
	"category" text DEFAULT 'general' NOT NULL,
	"title" text NOT NULL,
	"body_enc" text NOT NULL,
	"amount_kobo" bigint,
	"department_id" uuid,
	"member_id" uuid,
	"urgent" boolean DEFAULT false NOT NULL,
	"confidential" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"current_step" integer,
	"initiator_id" uuid NOT NULL,
	"initiator_name" text NOT NULL,
	"submitted_at" timestamp with time zone,
	"decided_at" timestamp with time zone,
	"disbursed_at" timestamp with time zone,
	"disbursed_by" uuid,
	"disbursed_by_name" text,
	"disbursed_kobo" bigint,
	"disbursement_ref" text,
	"expense_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memos_amount_ck" CHECK ("memos"."amount_kobo" is null or "memos"."amount_kobo" > 0)
);
--> statement-breakpoint
CREATE INDEX "memo_comments_memo_idx" ON "memo_comments" USING btree ("memo_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "memo_steps_uq" ON "memo_steps" USING btree ("memo_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "memo_views_uq" ON "memo_views" USING btree ("memo_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "memos_org_ref_uq" ON "memos" USING btree ("org_id","ref_no");--> statement-breakpoint
CREATE INDEX "memos_org_status_idx" ON "memos" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "memos_initiator_idx" ON "memos" USING btree ("org_id","initiator_id");