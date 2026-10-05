ALTER TABLE work_schedule_versions ADD COLUMN name text NOT NULL DEFAULT '', ADD COLUMN code text NOT NULL DEFAULT '';
UPDATE work_schedule_versions v SET name=s.name,code=s.code FROM work_schedules s WHERE s.id=v.schedule_id;
ALTER TABLE work_schedule_versions ALTER COLUMN name DROP DEFAULT, ALTER COLUMN code DROP DEFAULT;
ALTER TABLE work_schedule_versions ADD CHECK(length(btrim(name))>0), ADD CHECK(length(btrim(code))>0);
ALTER TABLE time_records ADD CHECK(source<>'manual' OR (reason IS NOT NULL AND length(btrim(reason))>0));
ALTER TABLE work_schedule_days ADD CHECK(is_work_day OR (start_time IS NULL AND end_time IS NULL AND break_start IS NULL AND break_end IS NULL));
