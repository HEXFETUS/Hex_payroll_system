-- Runtime privileges required by the Phase 4A sync transport.
-- Keep sync_changes append-only for the application role.

GRANT SELECT, INSERT, UPDATE ON sync_nodes TO hexpayroll_app;

GRANT SELECT, INSERT, UPDATE ON sync_outbox TO hexpayroll_app;

GRANT SELECT, INSERT ON sync_changes TO hexpayroll_app;
REVOKE UPDATE, DELETE, TRUNCATE ON sync_changes FROM hexpayroll_app;

GRANT SELECT, INSERT, UPDATE ON sync_conflicts TO hexpayroll_app;

GRANT SELECT, INSERT, UPDATE ON sync_inbox TO hexpayroll_app;

GRANT USAGE, SELECT ON SEQUENCE sync_changes_sequence_seq TO hexpayroll_app;