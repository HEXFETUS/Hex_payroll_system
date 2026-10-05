-- Background interpretation is a system action, not an action by an arbitrary staff account.
ALTER TABLE attendance_processing_jobs ALTER COLUMN requested_by DROP NOT NULL;
