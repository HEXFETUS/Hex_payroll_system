CREATE TABLE departments (
 id uuid PRIMARY KEY DEFAULT uuidv7(), organization_id uuid NOT NULL REFERENCES organizations(id), code text NOT NULL CHECK(length(btrim(code))>0), name text NOT NULL CHECK(length(btrim(name))>0), description text,
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive')), revision integer NOT NULL DEFAULT 1 CHECK(revision>0), updated_by uuid REFERENCES auth_users(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id,id)
);
CREATE UNIQUE INDEX departments_code_unique ON departments(organization_id,lower(code));
CREATE TABLE positions (
 id uuid PRIMARY KEY DEFAULT uuidv7(), organization_id uuid NOT NULL REFERENCES organizations(id), department_id uuid, code text NOT NULL CHECK(length(btrim(code))>0), name text NOT NULL CHECK(length(btrim(name))>0), description text,
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive')), revision integer NOT NULL DEFAULT 1 CHECK(revision>0), updated_by uuid REFERENCES auth_users(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id,id), FOREIGN KEY(organization_id,department_id) REFERENCES departments(organization_id,id)
);
CREATE UNIQUE INDEX positions_code_unique ON positions(organization_id,lower(code));
CREATE TABLE employees (
 id uuid PRIMARY KEY DEFAULT uuidv7(), organization_id uuid NOT NULL REFERENCES organizations(id), employee_number text NOT NULL CHECK(length(btrim(employee_number))>0),
 first_name text NOT NULL CHECK(length(btrim(first_name))>0), middle_name text, last_name text NOT NULL CHECK(length(btrim(last_name))>0), suffix text, birth_date date, email text, mobile_number text,
 address text, barangay text, city text, province text, postal_code text, sss_number text, philhealth_number text, pagibig_number text, tin text,
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive','on_leave','terminated')),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0), updated_by uuid REFERENCES auth_users(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id,id)
);
CREATE UNIQUE INDEX employees_number_unique ON employees(organization_id,lower(employee_number));
CREATE INDEX employees_search_idx ON employees(organization_id,status,last_name);
CREATE TABLE employment_versions (
 id uuid PRIMARY KEY DEFAULT uuidv7(), organization_id uuid NOT NULL REFERENCES organizations(id), employee_id uuid NOT NULL, department_id uuid, position_id uuid,
 effective_from date NOT NULL, effective_to date CHECK(effective_to > effective_from),
 employment_type text NOT NULL CHECK(employment_type IN ('regular','probationary','contractual','project_based','part_time')),
 employment_status text NOT NULL CHECK(employment_status IN ('active','inactive','on_leave','terminated')),
 hire_date date NOT NULL, regularization_date date CHECK(regularization_date >= hire_date), termination_date date CHECK(termination_date >= hire_date),
 pay_type text NOT NULL CHECK(pay_type IN ('monthly','daily','hourly')), pay_frequency text NOT NULL CHECK(pay_frequency IN ('monthly','semi_monthly','weekly','biweekly')),
 basic_rate_centavos bigint NOT NULL CHECK(basic_rate_centavos BETWEEN 0 AND 9007199254740991),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid REFERENCES auth_users(id),
 FOREIGN KEY(organization_id,employee_id) REFERENCES employees(organization_id,id), FOREIGN KEY(organization_id,department_id) REFERENCES departments(organization_id,id), FOREIGN KEY(organization_id,position_id) REFERENCES positions(organization_id,id), UNIQUE(employee_id,effective_from)
);
CREATE INDEX employment_employee_idx ON employment_versions(organization_id,employee_id,effective_from);
CREATE FUNCTION hex_validate_employment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM 1 FROM employees WHERE id=NEW.employee_id AND organization_id=NEW.organization_id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM employment_versions e WHERE e.employee_id=NEW.employee_id AND e.id<>NEW.id AND daterange(e.effective_from,e.effective_to,'[)') && daterange(NEW.effective_from,NEW.effective_to,'[)')) THEN
  RAISE EXCEPTION 'Employment periods overlap' USING ERRCODE='23514';
 END IF;
 IF NEW.position_id IS NOT NULL AND EXISTS(SELECT 1 FROM positions WHERE id=NEW.position_id AND department_id IS NOT NULL AND department_id IS DISTINCT FROM NEW.department_id) THEN
  RAISE EXCEPTION 'Position department mismatch' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER employment_integrity BEFORE INSERT OR UPDATE ON employment_versions FOR EACH ROW EXECUTE FUNCTION hex_validate_employment();
CREATE TABLE biometric_devices (id uuid PRIMARY KEY DEFAULT uuidv7(), organization_id uuid NOT NULL REFERENCES organizations(id), code text NOT NULL, name text NOT NULL, status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive')), revision integer NOT NULL DEFAULT 1 CHECK(revision>0), updated_by uuid REFERENCES auth_users(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id,id), UNIQUE(organization_id,code));
CREATE TABLE biometric_mappings (id uuid PRIMARY KEY DEFAULT uuidv7(), organization_id uuid NOT NULL REFERENCES organizations(id), employee_id uuid NOT NULL, device_id uuid NOT NULL, device_employee_id text NOT NULL CHECK(length(btrim(device_employee_id))>0), status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive')), revision integer NOT NULL DEFAULT 1 CHECK(revision>0), updated_by uuid REFERENCES auth_users(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), FOREIGN KEY(organization_id,employee_id) REFERENCES employees(organization_id,id), FOREIGN KEY(organization_id,device_id) REFERENCES biometric_devices(organization_id,id), UNIQUE(device_id,device_employee_id));
