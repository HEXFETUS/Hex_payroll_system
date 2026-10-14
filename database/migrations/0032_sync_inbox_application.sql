-- Safe receiver diagnostics; payloads and database error details are never logged.
ALTER TABLE sync_inbox
 ADD COLUMN apply_attempt_count integer NOT NULL DEFAULT 0,
 ADD COLUMN last_apply_attempt_at timestamptz,
 ADD COLUMN apply_error text;
CREATE INDEX sync_inbox_pending_idx ON sync_inbox(organization_id,sequence)
 WHERE applied_at IS NULL;
