-- Row-level security for messaging. message_refs has none: delivery reports arrive before we know the church.
SELECT bmc_enable_tenant_rls(t) FROM unnest(ARRAY[
  'message_campaigns','messages','message_templates','sms_ledger','sms_topups'
]::regclass[]) AS t;
--> statement-breakpoint
-- The SMS unit ledger is append-only: corrections are new rows.
CREATE OR REPLACE FUNCTION bmc_sms_ledger_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'SMS unit records cannot be changed or deleted. Add an adjustment instead.' USING ERRCODE = 'check_violation';
END $$;
--> statement-breakpoint
CREATE TRIGGER bmc_sms_ledger_guard BEFORE UPDATE OR DELETE ON sms_ledger
FOR EACH ROW EXECUTE FUNCTION bmc_sms_ledger_guard();
--> statement-breakpoint
-- Every church starts with free units to try SMS.
INSERT INTO sms_ledger (org_id, units, kind, note)
SELECT id, 50, 'welcome', 'Welcome units to try SMS' FROM organisations;
