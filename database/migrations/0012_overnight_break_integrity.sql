-- Time + interval wraps at midnight. Compare durations instead to retain day offsets.
ALTER TABLE work_schedule_days ADD CONSTRAINT schedule_break_absolute_bounds CHECK (
 break_start IS NULL OR (
 break_start-start_time+break_start_day_offset*interval '1 day'>=interval '0'
 AND break_end-end_time+(break_end_day_offset-end_day_offset)*interval '1 day'<=interval '0'
 AND break_end-break_start+(break_end_day_offset-break_start_day_offset)*interval '1 day'<end_time-start_time+end_day_offset*interval '1 day'
 ));
-- Replace the original wrapping bounds check while keeping every applied migration immutable.
DO $$ DECLARE constraint_name text; BEGIN
 SELECT conname INTO constraint_name FROM pg_constraint WHERE conrelid='work_schedule_days'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%break_start IS NULL%' AND conname<>'schedule_break_absolute_bounds';
 IF constraint_name IS NOT NULL THEN EXECUTE format('ALTER TABLE work_schedule_days DROP CONSTRAINT %I',constraint_name); END IF;
END $$;
ALTER TABLE work_schedule_days ADD CONSTRAINT schedule_break_pair CHECK (
 (break_start IS NULL AND break_end IS NULL) OR
 (break_start IS NOT NULL AND break_end IS NOT NULL AND start_time IS NOT NULL AND end_time IS NOT NULL AND break_end-break_start+(break_end_day_offset-break_start_day_offset)*interval '1 day'>interval '0')
);
