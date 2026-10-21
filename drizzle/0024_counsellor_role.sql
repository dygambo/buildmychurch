-- A Marriage Counsellor role for churches created before counselling existed.
INSERT INTO roles (org_id, key, name, description, permissions, is_system)
SELECT o.id, 'counsellor', 'Marriage Counsellor', 'Counsels the couples assigned to them: sessions, notes and checklists.', ARRAY['members.read','schedules.read','counselling.manage'], true
FROM organisations o
WHERE NOT EXISTS (SELECT 1 FROM roles r WHERE r.org_id = o.id AND r.key = 'counsellor');
