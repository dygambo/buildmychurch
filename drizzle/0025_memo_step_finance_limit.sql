ALTER TABLE "memo_route_steps" ADD COLUMN "min_source" text DEFAULT 'amount' NOT NULL;--> statement-breakpoint
-- The default "Senior Pastor from ₦50,000" step now follows the finance approval limit, so changing that limit
-- in finance settings changes who approves memos too.
UPDATE "memo_route_steps" SET "min_source" = 'finance_limit', "min_amount_kobo" = 0
WHERE "min_amount_kobo" = 5000000 AND ("role_key" = 'pastor' OR "label" = 'Senior Pastor');
