CREATE TABLE time_records (
 id uuid PRIMARY KEY DEFAULT uuidv7(), organization_id uuid NOT NULL REFERENCES organizations(id), employee_id uuid NOT NULL, recorded_at timestamptz NOT NULL, record_type text NOT NULL CHECK(record_type IN ('in','out','break_out','break_in','unknown')), source text NOT NULL CHECK(source IN ('biometric','manual','import','system')),
 device_id uuid, device_employee_id text, external_record_id text, reason text, created_by uuid NOT NULL REFERENCES auth_users(id), revision integer NOT NULL DEFAULT 1 CHECK(revision=1), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id,id), FOREIGN KEY(organization_id,employee_id) REFERENCES employees(organization_id,id), FOREIGN KEY(organization_id,device_id) REFERENCES biometric_devices(organization_id,id), CHECK(source<>'manual' OR length(btrim(reason))>0), CHECK(source<>'biometric' OR (device_id IS NOT NULL AND device_employee_id IS NOT NULL))
);
CREATE INDEX time_records_employee_date_idx ON time_records(organization_id,employee_id,recorded_at);
CREATE UNIQUE INDEX time_records_external_unique ON time_records(device_id,external_record_id) WHERE external_record_id IS NOT NULL;
CREATE UNIQUE INDEX time_records_fallback_unique ON time_records(device_id,device_employee_id,recorded_at,record_type) WHERE external_record_id IS NULL AND device_id IS NOT NULL;
CREATE TABLE time_record_corrections (
 id uuid PRIMARY KEY DEFAULT uuidv7(), organization_id uuid NOT NULL REFERENCES organizations(id), time_record_id uuid NOT NULL, operation text NOT NULL CHECK(operation IN ('replace','void')), recorded_at timestamptz, record_type text CHECK(record_type IN ('in','out','break_out','break_in','unknown')), reason text NOT NULL CHECK(length(btrim(reason))>0), revision integer NOT NULL CHECK(revision>0), created_by uuid NOT NULL REFERENCES auth_users(id), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(time_record_id,revision), FOREIGN KEY(organization_id,time_record_id) REFERENCES time_records(organization_id,id), CHECK(operation='void' OR (recorded_at IS NOT NULL AND record_type IS NOT NULL))
);
CREATE TABLE biometric_ingestion_state (device_id uuid PRIMARY KEY REFERENCES biometric_devices(id), last_ingestion_at timestamptz NOT NULL, last_record_at timestamptz);
REVOKE UPDATE,DELETE,TRUNCATE ON time_records,time_record_corrections FROM hexpayroll_app;
