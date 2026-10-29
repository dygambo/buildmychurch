CREATE TABLE "event_registrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"ticket_type_id" uuid NOT NULL,
	"member_id" uuid,
	"name" text NOT NULL,
	"email_enc" text,
	"email_hash" text,
	"phone_enc" text,
	"quantity" integer DEFAULT 1 NOT NULL,
	"amount_kobo" bigint DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"code" text NOT NULL,
	"payment_ref" text,
	"checked_in" integer DEFAULT 0 NOT NULL,
	"last_checkin_at" timestamp with time zone,
	"last_checkin_by" text,
	"source" text DEFAULT 'online' NOT NULL,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_registrations_qty_ck" CHECK ("event_registrations"."quantity" between 1 and 20 and "event_registrations"."checked_in" between 0 and "event_registrations"."quantity")
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	"venue" text,
	"capacity" integer,
	"status" text DEFAULT 'draft' NOT NULL,
	"registration_open" boolean DEFAULT true NOT NULL,
	"closes_at" timestamp with time zone,
	"ask_phone" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rota_slots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"date" date NOT NULL,
	"service_label" text DEFAULT 'Sunday service' NOT NULL,
	"position" text NOT NULL,
	"member_id" uuid,
	"status" text DEFAULT 'open' NOT NULL,
	"decline_reason" text,
	"responded_at" timestamp with time zone,
	"reminded_at" timestamp with time zone,
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ticket_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"name" text NOT NULL,
	"price_kobo" bigint DEFAULT 0 NOT NULL,
	"capacity" integer,
	"position" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ticket_types_price_ck" CHECK ("ticket_types"."price_kobo" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "event_registrations_code_uq" ON "event_registrations" USING btree ("code");--> statement-breakpoint
CREATE INDEX "event_registrations_event_idx" ON "event_registrations" USING btree ("org_id","event_id","status");--> statement-breakpoint
CREATE INDEX "events_org_start_idx" ON "events" USING btree ("org_id","starts_at");--> statement-breakpoint
CREATE INDEX "rota_slots_org_date_idx" ON "rota_slots" USING btree ("org_id","date","group_id");--> statement-breakpoint
CREATE INDEX "rota_slots_member_idx" ON "rota_slots" USING btree ("org_id","member_id","date");