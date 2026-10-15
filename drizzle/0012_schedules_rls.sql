-- Row-level security for service schedules.
SELECT bmc_enable_tenant_rls(t) FROM unnest(ARRAY[
  'service_schedules','schedule_items','schedule_assignments','schedule_templates','schedule_versions','schedule_notifications'
]::regclass[]) AS t;
--> statement-breakpoint
-- A published version is a record of what was sent. Only its PDF fields fill in afterwards.
CREATE OR REPLACE FUNCTION bmc_schedule_version_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Published schedule versions cannot be deleted.' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.snapshot IS DISTINCT FROM OLD.snapshot OR NEW.version IS DISTINCT FROM OLD.version
     OR NEW.schedule_id IS DISTINCT FROM OLD.schedule_id OR NEW.org_id IS DISTINCT FROM OLD.org_id
     OR NEW.published_at IS DISTINCT FROM OLD.published_at OR NEW.published_by IS DISTINCT FROM OLD.published_by THEN
    RAISE EXCEPTION 'Published schedule versions cannot be changed.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER bmc_schedule_version_guard BEFORE UPDATE OR DELETE ON schedule_versions
FOR EACH ROW EXECUTE FUNCTION bmc_schedule_version_guard();
--> statement-breakpoint
-- Starter templates for churches that signed up before schedules existed.
INSERT INTO schedule_templates (org_id, name, service_type, body, created_by_name)
SELECT o.id, 'Sunday celebration service', 'sunday',
  '{"title":"Sunday Celebration Service","startTime":"08:00","endTime":"10:30","venue":"Main auditorium","items":[{"title":"Opening prayer","durationMin":10},{"title":"Praise and worship","durationMin":25},{"title":"Scripture reading","durationMin":5},{"title":"Choir ministration","durationMin":10},{"title":"Announcements","durationMin":10},{"title":"Tithes and offering","durationMin":15},{"title":"Sermon","durationMin":50},{"title":"Altar call","durationMin":10},{"title":"Thanksgiving and first-timers","durationMin":10},{"title":"Benediction","durationMin":5}]}'::jsonb,
  'Build My Church'
FROM organisations o;
