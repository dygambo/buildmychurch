-- Prayer requests already captured on visitor cards move into the prayer list.
INSERT INTO prayer_requests (org_id, branch_id, member_id, name, body_enc, source, wants_contact, created_by_name, created_at)
SELECT f.org_id, m.branch_id, f.member_id, m.first_name || ' ' || m.last_name, f.prayer_request_enc, 'visitor_card', f.wants_visit, 'Visitor card', f.created_at
FROM followups f JOIN members m ON m.id = f.member_id
WHERE f.prayer_request_enc IS NOT NULL;
--> statement-breakpoint
-- Row-level security for prayer, pastoral care and forms.
SELECT bmc_enable_tenant_rls(t) FROM unnest(ARRAY['prayer_requests','care_cases','care_entries','forms','form_responses']::regclass[]) AS t;
