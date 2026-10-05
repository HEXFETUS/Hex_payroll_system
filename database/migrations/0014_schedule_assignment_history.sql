CREATE TABLE schedule_assignment_history (
 id uuid PRIMARY KEY DEFAULT uuidv7(), organization_id uuid NOT NULL REFERENCES organizations(id), assignment_id uuid NOT NULL, revision integer NOT NULL CHECK(revision>0), snapshot jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,assignment_id) REFERENCES employee_schedule_assignments(organization_id,id), UNIQUE(assignment_id,revision)
);
REVOKE UPDATE,DELETE,TRUNCATE ON schedule_assignment_history FROM hexpayroll_app;
