CREATE TABLE work_schedules (
 id uuid PRIMARY KEY DEFAULT uuidv7(), organization_id uuid NOT NULL REFERENCES organizations(id), code text NOT NULL CHECK(length(btrim(code))>0), name text NOT NULL CHECK(length(btrim(name))>0), description text,
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive')), revision integer NOT NULL DEFAULT 1 CHECK(revision>0), updated_by uuid REFERENCES auth_users(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id,id)
);
CREATE UNIQUE INDEX schedules_code_unique ON work_schedules(organization_id,lower(code));
CREATE TABLE work_schedule_versions (
 id uuid PRIMARY KEY DEFAULT uuidv7(), organization_id uuid NOT NULL REFERENCES organizations(id), schedule_id uuid NOT NULL, effective_from date NOT NULL, reason text, timezone text NOT NULL,
 revision integer NOT NULL DEFAULT 1 CHECK(revision=1), created_by uuid NOT NULL REFERENCES auth_users(id), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(schedule_id,effective_from), UNIQUE(organization_id,id), FOREIGN KEY(organization_id,schedule_id) REFERENCES work_schedules(organization_id,id)
);
CREATE TABLE work_schedule_days (
 id uuid PRIMARY KEY DEFAULT uuidv7(), organization_id uuid NOT NULL REFERENCES organizations(id), version_id uuid NOT NULL, day_of_week integer NOT NULL CHECK(day_of_week BETWEEN 0 AND 6), is_work_day boolean NOT NULL,
 start_time time, end_time time, end_day_offset integer NOT NULL DEFAULT 0 CHECK(end_day_offset IN (0,1)), break_start time, break_end time, break_start_day_offset integer NOT NULL DEFAULT 0 CHECK(break_start_day_offset IN (0,1)), break_end_day_offset integer NOT NULL DEFAULT 0 CHECK(break_end_day_offset IN (0,1)), grace_minutes integer NOT NULL DEFAULT 0 CHECK(grace_minutes BETWEEN 0 AND 240),
 UNIQUE(version_id,day_of_week), FOREIGN KEY(organization_id,version_id) REFERENCES work_schedule_versions(organization_id,id),
 CHECK(NOT is_work_day OR (start_time IS NOT NULL AND end_time IS NOT NULL AND end_time-start_time+end_day_offset*interval '1 day'>interval '0' AND end_time-start_time+end_day_offset*interval '1 day'<=interval '24 hours')),
 CHECK((break_start IS NULL AND break_end IS NULL) OR (break_start IS NOT NULL AND break_end IS NOT NULL AND start_time IS NOT NULL AND end_time IS NOT NULL AND break_start+break_start_day_offset*interval '1 day'>=start_time AND break_end+break_end_day_offset*interval '1 day'<=end_time+end_day_offset*interval '1 day' AND break_end-break_start+(break_end_day_offset-break_start_day_offset)*interval '1 day'>interval '0'))
);
CREATE TABLE employee_schedule_assignments (
 id uuid PRIMARY KEY DEFAULT uuidv7(), organization_id uuid NOT NULL REFERENCES organizations(id), employee_id uuid NOT NULL, schedule_id uuid NOT NULL, effective_from date NOT NULL, effective_to date CHECK(effective_to>effective_from), reason text,
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0), updated_by uuid REFERENCES auth_users(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id,id), FOREIGN KEY(organization_id,employee_id) REFERENCES employees(organization_id,id), FOREIGN KEY(organization_id,schedule_id) REFERENCES work_schedules(organization_id,id)
);
CREATE INDEX schedule_assignment_dates_idx ON employee_schedule_assignments(organization_id,employee_id,effective_from);
CREATE FUNCTION hex_validate_schedule_assignment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM 1 FROM employees WHERE id=NEW.employee_id AND organization_id=NEW.organization_id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM employee_schedule_assignments a WHERE a.employee_id=NEW.employee_id AND a.id<>NEW.id AND daterange(a.effective_from,a.effective_to,'[)') && daterange(NEW.effective_from,NEW.effective_to,'[)')) THEN RAISE EXCEPTION 'Schedule assignments overlap' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER schedule_assignment_integrity BEFORE INSERT OR UPDATE ON employee_schedule_assignments FOR EACH ROW EXECUTE FUNCTION hex_validate_schedule_assignment();
REVOKE UPDATE,DELETE,TRUNCATE ON work_schedule_versions,work_schedule_days FROM hexpayroll_app;
