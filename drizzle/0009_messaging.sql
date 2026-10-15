CREATE TABLE "message_campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"kind" text DEFAULT 'broadcast' NOT NULL,
	"automation_key" text,
	"channel" text NOT NULL,
	"name" text NOT NULL,
	"subject" text,
	"body" text NOT NULL,
	"wa_template" text,
	"audience" jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"scheduled_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"failure_reason" text,
	"recipients" integer DEFAULT 0 NOT NULL,
	"skipped" integer DEFAULT 0 NOT NULL,
	"units_used" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"created_by_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message_refs" (
	"provider_id" text PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"channel" text NOT NULL,
	"subject" text,
	"body" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"campaign_id" uuid,
	"channel" text NOT NULL,
	"purpose" text DEFAULT 'broadcast' NOT NULL,
	"member_id" uuid,
	"recipient_name" text,
	"to_enc" text,
	"to_masked" text,
	"subject" text,
	"body" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"skip_reason" text,
	"units" integer DEFAULT 0 NOT NULL,
	"provider" text,
	"provider_id" text,
	"error" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"claimed_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sms_ledger" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"units" integer NOT NULL,
	"kind" text NOT NULL,
	"campaign_id" uuid,
	"message_id" uuid,
	"reference" text,
	"amount_kobo" integer,
	"note" text,
	"created_by" uuid,
	"created_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sms_ledger_units_ck" CHECK ("sms_ledger"."units" <> 0)
);
--> statement-breakpoint
CREATE TABLE "sms_topups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"units" integer NOT NULL,
	"amount_kobo" integer NOT NULL,
	"reference" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_by" uuid,
	"created_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paid_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "message_campaigns_org_idx" ON "message_campaigns" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "messages_campaign_idx" ON "messages" USING btree ("campaign_id","status");--> statement-breakpoint
CREATE INDEX "messages_member_idx" ON "messages" USING btree ("org_id","member_id","created_at");--> statement-breakpoint
CREATE INDEX "messages_org_date_idx" ON "messages" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "sms_ledger_org_idx" ON "sms_ledger" USING btree ("org_id","created_at");