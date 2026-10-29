-- Row-level security for E-Memo.
SELECT bmc_enable_tenant_rls(t) FROM unnest(ARRAY[
  'memo_templates','memo_route_steps','memos','memo_steps','memo_comments','memo_views'
]::regclass[]) AS t;
--> statement-breakpoint
-- A decided memo is a record: its content, amount and decision can't be changed afterwards.
CREATE OR REPLACE FUNCTION bmc_memo_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN
      RAISE EXCEPTION 'Only draft memos can be deleted.' USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status IN ('approved', 'declined', 'withdrawn') AND (
       NEW.body_enc IS DISTINCT FROM OLD.body_enc OR NEW.title IS DISTINCT FROM OLD.title
    OR NEW.amount_kobo IS DISTINCT FROM OLD.amount_kobo OR NEW.status IS DISTINCT FROM OLD.status
    OR NEW.ref_no IS DISTINCT FROM OLD.ref_no OR NEW.confidential IS DISTINCT FROM OLD.confidential
    OR (OLD.disbursed_at IS NOT NULL AND NEW.disbursed_at IS DISTINCT FROM OLD.disbursed_at)
  ) THEN
    RAISE EXCEPTION 'Decided memos cannot be changed.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER bmc_memo_guard BEFORE UPDATE OR DELETE ON memos FOR EACH ROW EXECUTE FUNCTION bmc_memo_guard();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION bmc_memo_step_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status IN ('approved', 'declined') THEN
      RAISE EXCEPTION 'Recorded approvals cannot be deleted.' USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status IN ('approved', 'declined') AND (NEW.status IS DISTINCT FROM OLD.status OR NEW.acted_by IS DISTINCT FROM OLD.acted_by OR NEW.stamp IS DISTINCT FROM OLD.stamp OR NEW.acted_at IS DISTINCT FROM OLD.acted_at) THEN
    RAISE EXCEPTION 'Recorded approvals cannot be changed.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER bmc_memo_step_guard BEFORE UPDATE OR DELETE ON memo_steps FOR EACH ROW EXECUTE FUNCTION bmc_memo_step_guard();
--> statement-breakpoint
INSERT INTO memo_route_steps (org_id, position, label, role_key, min_amount_kobo)
SELECT o.id, s.position, s.label, s.role_key, s.min_amount_kobo
FROM organisations o
CROSS JOIN (VALUES (1, 'Church Administrator', 'admin', 0), (2, 'Senior Pastor', 'pastor', 5000000)) AS s(position, label, role_key, min_amount_kobo);
