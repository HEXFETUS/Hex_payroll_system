-- Restrict Phase 4A sync runtime tables to the operations used by the application.
-- Sync transport records must not be deleted or truncated by the runtime role.

REVOKE DELETE, TRUNCATE ON
  sync_nodes,
  sync_outbox,
  sync_changes,
  sync_conflicts,
  sync_inbox
FROM hexpayroll_app;