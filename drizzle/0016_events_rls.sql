-- Row-level security for events and the volunteer rota.
SELECT bmc_enable_tenant_rls(t) FROM unnest(ARRAY['events','ticket_types','event_registrations','rota_slots']::regclass[]) AS t;
