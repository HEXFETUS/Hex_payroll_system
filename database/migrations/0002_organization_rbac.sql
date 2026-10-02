CREATE TABLE organizations (
 id uuid PRIMARY KEY DEFAULT uuidv7(), legal_name text NOT NULL CHECK(length(btrim(legal_name)) > 0),
 trade_name text, tin text, rdo_code text, sss_number text, philhealth_number text, pagibig_number text,
 address text, barangay text, city text, province text, postal_code text, country char(2) NOT NULL DEFAULT 'PH',
 phone text, email text, timezone text NOT NULL DEFAULT 'Asia/Manila', currency char(3) NOT NULL DEFAULT 'PHP',
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive')),
 revision integer NOT NULL DEFAULT 1 CHECK(revision > 0), updated_by uuid,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE application_setup (singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), organization_id uuid UNIQUE REFERENCES organizations(id), administrator_id uuid REFERENCES auth_users(id));
INSERT INTO application_setup(singleton) VALUES(true);
ALTER TABLE auth_users ALTER COLUMN id SET DEFAULT uuidv7();
ALTER TABLE auth_users ADD COLUMN organization_id uuid REFERENCES organizations(id), ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(), ADD COLUMN last_login_at timestamptz, ADD COLUMN revision integer NOT NULL DEFAULT 1 CHECK(revision > 0), ADD COLUMN updated_by uuid REFERENCES auth_users(id);
ALTER TABLE auth_users ADD CONSTRAINT auth_users_org_id_unique UNIQUE(organization_id,id);
ALTER TABLE organizations ADD CONSTRAINT organizations_updated_by_fk FOREIGN KEY(updated_by) REFERENCES auth_users(id);
CREATE TABLE permissions (code text PRIMARY KEY);
INSERT INTO permissions(code) VALUES
 ('dashboard.view'),('employees.view'),('employees.create'),('employees.update'),('employees.archive'),('employees.sensitive.view'),('employees.sensitive.update'),
 ('attendance.view'),('attendance.manage'),('users.view'),('users.create'),('users.update'),('users.disable'),('roles.view'),('roles.manage'),
 ('organization.view'),('organization.update'),('departments.view'),('departments.manage'),('positions.view'),('positions.manage'),
 ('payroll_config.view'),('payroll_config.update'),('system_health.view'),('audit.view'),('sync.view');
CREATE TABLE roles (id uuid PRIMARY KEY DEFAULT uuidv7(), code text NOT NULL UNIQUE, name text NOT NULL CHECK(length(btrim(name)) > 0), system boolean NOT NULL DEFAULT false, organization_id uuid REFERENCES organizations(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE user_roles (user_id uuid NOT NULL REFERENCES auth_users(id), role_id uuid NOT NULL REFERENCES roles(id), PRIMARY KEY(user_id,role_id));
CREATE TABLE role_permissions (role_id uuid NOT NULL REFERENCES roles(id), permission_code text NOT NULL REFERENCES permissions(code), PRIMARY KEY(role_id,permission_code));
INSERT INTO roles(code,name,system) VALUES ('administrator','Administrator',true),('payroll_manager','Payroll Manager',true),('payroll_clerk','Payroll Clerk',true),('viewer','Viewer',true);
INSERT INTO role_permissions SELECT r.id,p.code FROM roles r CROSS JOIN permissions p WHERE r.code='administrator';
INSERT INTO role_permissions SELECT r.id,p.code FROM roles r CROSS JOIN permissions p WHERE r.code='payroll_manager' AND (p.code LIKE 'employees.%' OR p.code LIKE 'departments.%' OR p.code LIKE 'positions.%' OR p.code LIKE 'payroll_config.%' OR p.code IN ('dashboard.view','attendance.view','attendance.manage','organization.view','audit.view','sync.view','system_health.view'));
INSERT INTO role_permissions SELECT r.id,p.code FROM roles r CROSS JOIN permissions p WHERE r.code='payroll_clerk' AND (p.code LIKE 'employees.%' OR p.code IN ('dashboard.view','attendance.view','attendance.manage','departments.view','positions.view'));
INSERT INTO role_permissions SELECT r.id,p.code FROM roles r CROSS JOIN permissions p WHERE r.code='viewer' AND p.code IN ('dashboard.view','employees.view','departments.view','positions.view','attendance.view');
INSERT INTO user_roles SELECT u.id,r.id FROM auth_users u CROSS JOIN roles r WHERE r.code='viewer';
