-- Row-level security: every tenant table only shows rows for the church set in app.org_id.
-- The table owner (used for migrations and seeding) bypasses these policies; the app role does not.
CREATE OR REPLACE FUNCTION bmc_enable_tenant_rls(tbl regclass) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', tbl);
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = tbl::text AND policyname = 'tenant_isolation') THEN
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %s USING (org_id = nullif(current_setting(''app.org_id'', true), '''')::uuid) WITH CHECK (org_id = nullif(current_setting(''app.org_id'', true), '''')::uuid)',
      tbl);
  END IF;
END $$;
--> statement-breakpoint
SELECT bmc_enable_tenant_rls(t) FROM unnest(ARRAY[
  'branches','audit_logs','files','members','households','tags','member_tags','groups','group_members','consents','import_jobs','data_requests'
]::regclass[]) AS t;
