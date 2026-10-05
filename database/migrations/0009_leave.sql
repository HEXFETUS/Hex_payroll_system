CREATE TABLE leave_types (
 id uuid PRIMARY KEY DEFAULT uuidv7(), organization_id uuid NOT NULL REFERENCES organizations(id), code text NOT NULL CHECK(length(btrim(code))>0), name text NOT NULL CHECK(length(btrim(name))>0), description text, paid boolean NOT NULL, requires_approval boolean NOT NULL DEFAULT true, status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive')),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0), updated_by uuid REFERENCES auth_users(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id,id)
);
CREATE UNIQUE INDEX leave_types_code_unique ON leave_types(organization_id,lower(code));
CREATE TABLE leave_requests (
 id uuid PRIMARY KEY DEFAULT uuidv7(), organization_id uuid NOT NULL REFERENCES organizations(id), employee_id uuid NOT NULL, leave_type_id uuid NOT NULL, start_date date NOT NULL, end_date date NOT NULL CHECK(end_date>=start_date), duration_type text NOT NULL CHECK(duration_type IN ('full_day','first_half','second_half')), reason text NOT NULL CHECK(length(btrim(reason))>0), status text NOT NULL CHECK(status IN ('pending','approved','rejected','cancelled')), type_snapshot jsonb NOT NULL,
 requested_by uuid NOT NULL REFERENCES auth_users(id), requested_at timestamptz NOT NULL DEFAULT now(), approved_by uuid REFERENCES auth_users(id), approved_at timestamptz, rejected_by uuid REFERENCES auth_users(id), rejected_at timestamptz, cancelled_by uuid REFERENCES auth_users(id), cancelled_at timestamptz, remarks text,
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0), updated_by uuid REFERENCES auth_users(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id,id), FOREIGN KEY(organization_id,employee_id) REFERENCES employees(organization_id,id), FOREIGN KEY(organization_id,leave_type_id) REFERENCES leave_types(organization_id,id), CHECK(duration_type='full_day' OR start_date=end_date)
);
CREATE INDEX leave_employee_dates_idx ON leave_requests(organization_id,employee_id,start_date,end_date);
CREATE INDEX leave_pending_idx ON leave_requests(organization_id,status,start_date);
CREATE FUNCTION hex_validate_leave_overlap() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM 1 FROM employees WHERE id=NEW.employee_id AND organization_id=NEW.organization_id FOR UPDATE;
 IF NEW.status IN ('pending','approved') AND EXISTS(SELECT 1 FROM leave_requests l WHERE l.employee_id=NEW.employee_id AND l.id<>NEW.id AND l.status IN ('pending','approved') AND l.start_date<=NEW.end_date AND l.end_date>=NEW.start_date AND (l.duration_type='full_day' OR NEW.duration_type='full_day' OR l.duration_type=NEW.duration_type)) THEN RAISE EXCEPTION 'Leave overlaps' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER leave_overlap BEFORE INSERT OR UPDATE ON leave_requests FOR EACH ROW EXECUTE FUNCTION hex_validate_leave_overlap();
