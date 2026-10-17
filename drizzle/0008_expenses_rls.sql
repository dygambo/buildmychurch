-- Row-level security for expenses, budgets, remittances, assets and files.
SELECT bmc_enable_tenant_rls(t) FROM unnest(ARRAY[
  'expense_categories','expenses','budget_lines','remittances','assets'
]::regclass[]) AS t;
--> statement-breakpoint
-- Paid expenses are final. The only change allowed is voiding them, with a reason.
CREATE OR REPLACE FUNCTION bmc_expense_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status NOT IN ('draft', 'rejected') THEN
      RAISE EXCEPTION 'Only draft or sent-back expenses can be deleted.' USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'void' THEN
    RAISE EXCEPTION 'Voided expenses cannot be changed.' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'paid' AND (
       NEW.status NOT IN ('paid', 'void')
    OR NEW.org_id IS DISTINCT FROM OLD.org_id
    OR NEW.branch_id IS DISTINCT FROM OLD.branch_id
    OR NEW.category_id IS DISTINCT FROM OLD.category_id
    OR NEW.fund_id IS DISTINCT FROM OLD.fund_id
    OR NEW.amount_kobo IS DISTINCT FROM OLD.amount_kobo
    OR NEW.spent_on IS DISTINCT FROM OLD.spent_on
    OR NEW.payee IS DISTINCT FROM OLD.payee
    OR NEW.expense_no IS DISTINCT FROM OLD.expense_no
    OR NEW.approved_by IS DISTINCT FROM OLD.approved_by
    OR NEW.paid_by IS DISTINCT FROM OLD.paid_by
    OR NEW.paid_at IS DISTINCT FROM OLD.paid_at
  ) THEN
    RAISE EXCEPTION 'Paid expenses cannot be changed. Void it and record it again.' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status = 'void' AND (NEW.void_reason IS NULL OR NEW.voided_by IS NULL) THEN
    RAISE EXCEPTION 'Voiding needs a reason and who did it.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER bmc_expense_guard BEFORE UPDATE OR DELETE ON expenses
FOR EACH ROW EXECUTE FUNCTION bmc_expense_guard();
--> statement-breakpoint
-- A confirmed remittance is settled history.
CREATE OR REPLACE FUNCTION bmc_remittance_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'confirmed' THEN
      RAISE EXCEPTION 'Confirmed remittances cannot be deleted.' USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'confirmed' THEN
    RAISE EXCEPTION 'Confirmed remittances cannot be changed.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER bmc_remittance_guard BEFORE UPDATE OR DELETE ON remittances
FOR EACH ROW EXECUTE FUNCTION bmc_remittance_guard();
--> statement-breakpoint
INSERT INTO expense_categories (org_id, name, code, color, sort_order)
SELECT o.id, c.name, c.code, c.color, c.sort_order
FROM organisations o
CROSS JOIN (VALUES
  ('Salaries & allowances', 'SALARY', 'c1', 1),
  ('Utilities, fuel & diesel', 'UTIL', 'c4', 2),
  ('Rent, repairs & maintenance', 'MAINT', 'c5', 3),
  ('Ministry & programmes', 'MINISTRY', 'c3', 4),
  ('Welfare & benevolence', 'WELFARE', 'c2', 5),
  ('Outreach & missions', 'OUTREACH', 'c6', 6),
  ('Equipment & instruments', 'EQUIP', 'c1', 7),
  ('Office & administration', 'ADMIN', 'c4', 8),
  ('Building project', 'BUILD', 'c5', 9)
) AS c(name, code, color, sort_order)
ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- New permission: approving expenses above the threshold and confirming remittances.
UPDATE roles SET permissions = array_append(permissions, 'finance.approve')
WHERE key IN ('owner', 'pastor') AND NOT ('finance.approve' = ANY(permissions));
