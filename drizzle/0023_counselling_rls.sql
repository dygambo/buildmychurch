-- Row-level security for marriage counselling.
SELECT bmc_enable_tenant_rls(t) FROM unnest(ARRAY['counselling_cases','counselling_sessions']::regclass[]) AS t;
--> statement-breakpoint
-- Super Admins and Senior Pastors get the new counselling permissions.
UPDATE roles SET permissions = array_cat(permissions, ARRAY['counselling.manage','counselling.oversee'])
WHERE key IN ('owner','pastor') AND NOT ('counselling.manage' = ANY(permissions));
