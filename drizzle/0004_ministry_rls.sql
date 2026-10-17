-- Row-level security for Phase 3 tables. public_links is looked up by token before the church is known, so it has none.
SELECT bmc_enable_tenant_rls(t) FROM unnest(ARRAY[
  'service_templates','services','attendance','followups','followup_notes',
  'children','guardians','child_guardians','child_checkins','child_events'
]::regclass[]) AS t;
