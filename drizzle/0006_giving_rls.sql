-- Row-level security for giving. payment_intents and payment_events have none: webhooks arrive before we know the church.
SELECT bmc_enable_tenant_rls(t) FROM unnest(ARRAY[
  'giving_funds','giving_transactions','giving_batches','giving_batch_lines','pledge_campaigns','pledges'
]::regclass[]) AS t;
--> statement-breakpoint
-- The giving ledger is append-only once a gift is confirmed. Corrections are reversals (a new negative row).
CREATE OR REPLACE FUNCTION bmc_giving_tx_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'confirmed' THEN
      RAISE EXCEPTION 'Confirmed giving records cannot be deleted. Reverse them instead.' USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'confirmed' AND (
       NEW.status IS DISTINCT FROM OLD.status
    OR NEW.org_id IS DISTINCT FROM OLD.org_id
    OR NEW.branch_id IS DISTINCT FROM OLD.branch_id
    OR NEW.fund_id IS DISTINCT FROM OLD.fund_id
    OR NEW.amount_kobo IS DISTINCT FROM OLD.amount_kobo
    OR NEW.fee_kobo IS DISTINCT FROM OLD.fee_kobo
    OR NEW.channel IS DISTINCT FROM OLD.channel
    OR NEW.source IS DISTINCT FROM OLD.source
    OR NEW.given_on IS DISTINCT FROM OLD.given_on
    OR NEW.batch_id IS DISTINCT FROM OLD.batch_id
    OR NEW.reference IS DISTINCT FROM OLD.reference
    OR NEW.reversal_of IS DISTINCT FROM OLD.reversal_of
    OR NEW.confirmed_at IS DISTINCT FROM OLD.confirmed_at
    OR (OLD.receipt_no IS NOT NULL AND NEW.receipt_no IS DISTINCT FROM OLD.receipt_no)
    OR (OLD.reversed_at IS NOT NULL AND NEW.reversed_at IS DISTINCT FROM OLD.reversed_at)
  ) THEN
    RAISE EXCEPTION 'Confirmed giving records cannot be changed. Reverse them instead.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER giving_tx_guard BEFORE UPDATE OR DELETE ON giving_transactions
  FOR EACH ROW EXECUTE FUNCTION bmc_giving_tx_guard();
--> statement-breakpoint
-- A verified batch is final: it can't be edited or deleted, and neither can its lines.
CREATE OR REPLACE FUNCTION bmc_giving_batch_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'verified' THEN
    RAISE EXCEPTION 'Verified batches cannot be changed.' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER giving_batch_guard BEFORE UPDATE OR DELETE ON giving_batches
  FOR EACH ROW EXECUTE FUNCTION bmc_giving_batch_guard();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION bmc_giving_line_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE s text;
BEGIN
  SELECT status INTO s FROM giving_batches WHERE id = COALESCE(NEW.batch_id, OLD.batch_id);
  IF s IS NULL OR s NOT IN ('draft', 'rejected') THEN
    RAISE EXCEPTION 'Lines can only change while a batch is a draft or has been sent back.' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER giving_line_guard BEFORE INSERT OR UPDATE OR DELETE ON giving_batch_lines
  FOR EACH ROW EXECUTE FUNCTION bmc_giving_line_guard();
--> statement-breakpoint
-- Default funds for churches created before giving existed (new churches get them at sign-up).
INSERT INTO giving_funds (org_id, name, code, restricted, color, sort_order)
SELECT o.id, f.name, f.code, f.restricted, f.color, f.sort_order
FROM organisations o
CROSS JOIN (VALUES
  ('Tithe', 'TITHE', false, 'c1', 1),
  ('Offering', 'OFFERING', false, 'c3', 2),
  ('Thanksgiving', 'THANKS', false, 'c4', 3),
  ('Building Fund', 'BUILDING', true, 'c5', 4),
  ('Welfare', 'WELFARE', true, 'c2', 5),
  ('Seed & Projects', 'SEED', false, 'c6', 6)
) AS f(name, code, restricted, color, sort_order)
ON CONFLICT DO NOTHING;
