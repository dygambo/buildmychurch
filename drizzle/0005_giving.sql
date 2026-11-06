CREATE TABLE "giving_batch_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"fund_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"amount_kobo" bigint NOT NULL,
	"member_id" uuid,
	"donor_name" text,
	"campaign_id" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "giving_batch_lines_amount_ck" CHECK ("giving_batch_lines"."amount_kobo" > 0)
);
--> statement-breakpoint
CREATE TABLE "giving_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"batch_no" text NOT NULL,
	"kind" text DEFAULT 'service' NOT NULL,
	"service_id" uuid,
	"label" text NOT NULL,
	"given_on" date NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"cash_count" jsonb,
	"notes" text,
	"total_kobo" bigint DEFAULT 0 NOT NULL,
	"counted_by" uuid NOT NULL,
	"counted_by_name" text NOT NULL,
	"submitted_at" timestamp with time zone,
	"verified_by" uuid,
	"verified_by_name" text,
	"verified_at" timestamp with time zone,
	"rejection_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "giving_batches_two_person_ck" CHECK ("giving_batches"."verified_by" is null or "giving_batches"."verified_by" <> "giving_batches"."counted_by")
);
--> statement-breakpoint
CREATE TABLE "giving_funds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"description" text,
	"restricted" boolean DEFAULT false NOT NULL,
	"online" boolean DEFAULT true NOT NULL,
	"color" text DEFAULT 'c1' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "giving_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"fund_id" uuid NOT NULL,
	"member_id" uuid,
	"donor_name" text,
	"donor_email_enc" text,
	"donor_phone_enc" text,
	"anonymous" boolean DEFAULT false NOT NULL,
	"amount_kobo" bigint NOT NULL,
	"fee_kobo" bigint DEFAULT 0 NOT NULL,
	"channel" text NOT NULL,
	"gateway_channel" text,
	"source" text NOT NULL,
	"status" text DEFAULT 'confirmed' NOT NULL,
	"given_on" date NOT NULL,
	"batch_id" uuid,
	"service_id" uuid,
	"campaign_id" uuid,
	"pledge_id" uuid,
	"reference" text NOT NULL,
	"gateway_ref" text,
	"receipt_no" text,
	"receipt_sent_at" timestamp with time zone,
	"reversal_of" uuid,
	"reversed_at" timestamp with time zone,
	"reversed_by" uuid,
	"note" text,
	"created_by" uuid,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "giving_tx_sign_ck" CHECK (("giving_transactions"."reversal_of" is null and "giving_transactions"."amount_kobo" > 0) or ("giving_transactions"."reversal_of" is not null and "giving_transactions"."amount_kobo" < 0))
);
--> statement-breakpoint
CREATE TABLE "payment_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"event" text,
	"reference" text,
	"signature_ok" boolean NOT NULL,
	"payload" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_intents" (
	"reference" text PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"target_id" uuid NOT NULL,
	"amount_kobo" bigint NOT NULL,
	"email" text NOT NULL,
	"provider" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"provider_tx_id" text,
	"gateway_channel" text,
	"fee_kobo" bigint,
	"paid_at" timestamp with time zone,
	"failure_reason" text,
	"last_checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pledge_campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"fund_id" uuid NOT NULL,
	"goal_kobo" bigint NOT NULL,
	"starts_on" date,
	"ends_on" date,
	"status" text DEFAULT 'active' NOT NULL,
	"show_online" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pledges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"member_id" uuid,
	"pledger_name" text NOT NULL,
	"amount_kobo" bigint NOT NULL,
	"due_on" date,
	"status" text DEFAULT 'open' NOT NULL,
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pledges_amount_ck" CHECK ("pledges"."amount_kobo" > 0)
);
--> statement-breakpoint
CREATE INDEX "giving_batch_lines_batch_idx" ON "giving_batch_lines" USING btree ("batch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "giving_batches_org_no_uq" ON "giving_batches" USING btree ("org_id","batch_no");--> statement-breakpoint
CREATE INDEX "giving_batches_org_status_idx" ON "giving_batches" USING btree ("org_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "giving_funds_org_code_uq" ON "giving_funds" USING btree ("org_id","code");--> statement-breakpoint
CREATE INDEX "giving_tx_org_date_idx" ON "giving_transactions" USING btree ("org_id","given_on");--> statement-breakpoint
CREATE INDEX "giving_tx_org_fund_idx" ON "giving_transactions" USING btree ("org_id","fund_id","given_on");--> statement-breakpoint
CREATE INDEX "giving_tx_member_idx" ON "giving_transactions" USING btree ("org_id","member_id");--> statement-breakpoint
CREATE INDEX "giving_tx_batch_idx" ON "giving_transactions" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "giving_tx_campaign_idx" ON "giving_transactions" USING btree ("org_id","campaign_id");--> statement-breakpoint
CREATE UNIQUE INDEX "giving_tx_org_ref_uq" ON "giving_transactions" USING btree ("org_id","reference");--> statement-breakpoint
CREATE UNIQUE INDEX "giving_tx_org_receipt_uq" ON "giving_transactions" USING btree ("org_id","receipt_no");--> statement-breakpoint
CREATE UNIQUE INDEX "giving_tx_reversal_uq" ON "giving_transactions" USING btree ("reversal_of");--> statement-breakpoint
CREATE INDEX "payment_intents_status_idx" ON "payment_intents" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "pledges_campaign_idx" ON "pledges" USING btree ("org_id","campaign_id");--> statement-breakpoint
CREATE INDEX "pledges_member_idx" ON "pledges" USING btree ("org_id","member_id");