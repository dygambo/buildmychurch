CREATE TABLE "assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"asset_no" text NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"description" text,
	"serial_no" text,
	"location" text,
	"custodian" text,
	"purchased_on" date,
	"cost_kobo" bigint DEFAULT 0 NOT NULL,
	"useful_life_months" integer,
	"salvage_kobo" bigint DEFAULT 0 NOT NULL,
	"condition" text DEFAULT 'good' NOT NULL,
	"status" text DEFAULT 'in_use' NOT NULL,
	"disposed_on" date,
	"disposal_kobo" bigint,
	"disposal_note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "budget_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"branch_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"amount_kobo" bigint NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budget_lines_amount_ck" CHECK ("budget_lines"."amount_kobo" >= 0)
);
--> statement-breakpoint
CREATE TABLE "expense_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"description" text,
	"color" text DEFAULT 'c1' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"expense_no" text NOT NULL,
	"category_id" uuid NOT NULL,
	"fund_id" uuid,
	"payee" text NOT NULL,
	"description" text NOT NULL,
	"amount_kobo" bigint NOT NULL,
	"spent_on" date NOT NULL,
	"method" text DEFAULT 'transfer' NOT NULL,
	"payment_ref" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"requested_by" uuid NOT NULL,
	"requested_by_name" text NOT NULL,
	"submitted_at" timestamp with time zone,
	"auto_approved" boolean DEFAULT false NOT NULL,
	"approved_by" uuid,
	"approved_by_name" text,
	"approved_at" timestamp with time zone,
	"rejection_note" text,
	"paid_by" uuid,
	"paid_by_name" text,
	"paid_at" timestamp with time zone,
	"voided_by" uuid,
	"void_reason" text,
	"voided_at" timestamp with time zone,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expenses_amount_ck" CHECK ("expenses"."amount_kobo" > 0),
	CONSTRAINT "expenses_two_person_ck" CHECK ("expenses"."approved_by" is null or "expenses"."auto_approved" or "expenses"."approved_by" <> "expenses"."requested_by")
);
--> statement-breakpoint
CREATE TABLE "remittances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"period" text NOT NULL,
	"income_kobo" bigint NOT NULL,
	"rate_bps" integer NOT NULL,
	"due_kobo" bigint NOT NULL,
	"paid_kobo" bigint DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'due' NOT NULL,
	"paid_on" date,
	"method" text,
	"payment_ref" text,
	"note" text,
	"submitted_by" uuid,
	"submitted_by_name" text,
	"submitted_at" timestamp with time zone,
	"confirmed_by" uuid,
	"confirmed_by_name" text,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "remittances_two_person_ck" CHECK ("remittances"."confirmed_by" is null or "remittances"."confirmed_by" <> "remittances"."submitted_by")
);
--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "entity_type" text NOT NULL;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "entity_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "uploaded_by_name" text;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "assets_org_no_uq" ON "assets" USING btree ("org_id","asset_no");--> statement-breakpoint
CREATE INDEX "assets_org_cat_idx" ON "assets" USING btree ("org_id","category");--> statement-breakpoint
CREATE UNIQUE INDEX "budget_lines_uq" ON "budget_lines" USING btree ("org_id","year","branch_id","category_id");--> statement-breakpoint
CREATE UNIQUE INDEX "expense_categories_org_code_uq" ON "expense_categories" USING btree ("org_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "expenses_org_no_uq" ON "expenses" USING btree ("org_id","expense_no");--> statement-breakpoint
CREATE INDEX "expenses_org_date_idx" ON "expenses" USING btree ("org_id","spent_on");--> statement-breakpoint
CREATE INDEX "expenses_org_status_idx" ON "expenses" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "expenses_org_cat_idx" ON "expenses" USING btree ("org_id","category_id","spent_on");--> statement-breakpoint
CREATE UNIQUE INDEX "remittances_uq" ON "remittances" USING btree ("org_id","branch_id","period");--> statement-breakpoint
CREATE INDEX "files_entity_idx" ON "files" USING btree ("org_id","entity_type","entity_id");