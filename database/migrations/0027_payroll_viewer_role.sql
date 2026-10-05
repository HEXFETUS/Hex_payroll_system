-- Every new account inherits Viewer. Financial access must be explicitly granted
-- rather than becoming visible automatically to all authenticated accounts.
DELETE FROM role_permissions WHERE role_id IN (SELECT id FROM roles WHERE code='viewer') AND permission_code IN ('payroll.view','earnings.view','deductions.view','contributions.view','tax.view');
INSERT INTO roles(code,name,system) VALUES('payroll_viewer','Payroll Viewer',true);
INSERT INTO role_permissions SELECT r.id,p.code FROM roles r CROSS JOIN permissions p WHERE r.code='payroll_viewer' AND p.code IN ('payroll.view','earnings.view','deductions.view','contributions.view','tax.view');
