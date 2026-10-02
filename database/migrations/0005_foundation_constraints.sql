ALTER TABLE organizations ADD CONSTRAINT organizations_locale_check CHECK(country='PH' AND currency='PHP');
ALTER TABLE biometric_devices ADD CONSTRAINT biometric_devices_names_check CHECK(length(btrim(code))>0 AND length(btrim(name))>0);
ALTER TABLE sync_nodes ADD CONSTRAINT sync_nodes_name_check CHECK(length(btrim(device_name))>0);
ALTER TABLE sync_outbox ADD CONSTRAINT sync_outbox_version_check CHECK(payload_version>0);
ALTER TABLE payroll_configurations ADD CONSTRAINT payroll_configuration_required_check CHECK(
 configuration ?& ARRAY['payFrequency','workWeekdays','workStart','workEnd','breakMinutes','standardMinutesPerDay','graceMinutes','lateEnabled','undertimeEnabled','overtimeEnabled','roundingMode','roundingIncrementMinutes']
 AND configuration->>'payFrequency' IN ('monthly','semi_monthly','weekly','biweekly')
 AND configuration->>'roundingMode' IN ('none','nearest','up','down')
 AND jsonb_typeof(configuration->'workWeekdays')='array'
 AND jsonb_typeof(configuration->'lateEnabled')='boolean'
 AND jsonb_typeof(configuration->'undertimeEnabled')='boolean'
 AND jsonb_typeof(configuration->'overtimeEnabled')='boolean'
 AND (configuration->>'breakMinutes')::integer BETWEEN 0 AND 1440
 AND (configuration->>'standardMinutesPerDay')::integer BETWEEN 1 AND 1440
 AND (configuration->>'graceMinutes')::integer BETWEEN 0 AND 1440
 AND (configuration->>'roundingIncrementMinutes')::integer BETWEEN 1 AND 60
);
CREATE INDEX positions_department_idx ON positions(organization_id,department_id);
CREATE INDEX mappings_employee_idx ON biometric_mappings(organization_id,employee_id);
CREATE INDEX user_roles_role_idx ON user_roles(role_id);
