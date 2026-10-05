ALTER TABLE attendance_processing_jobs ADD COLUMN priority smallint NOT NULL DEFAULT 0, ADD COLUMN last_processed_at timestamptz, ADD COLUMN reason text;
CREATE INDEX attendance_jobs_claim_idx ON attendance_processing_jobs(priority DESC,COALESCE(last_processed_at,created_at),id) WHERE last_error IS NULL;
