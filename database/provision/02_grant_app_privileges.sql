-- ============================================================================
-- Hex Payroll — Step 2 of 2: privilege model inside hexpayroll_dev.
--
-- Run as a superuser (or as hexpayroll_migrator, which owns the database),
-- connected to `hexpayroll_dev` itself:
--
--   psql -h 127.0.0.1 -U postgres -d hexpayroll_dev -f database/provision/02_grant_app_privileges.sql
--
-- WHY THE ALTER DEFAULT PRIVILEGES STATEMENTS MATTER
--   Without them, every table the migrator creates in Phase 1 would be invisible
--   to hexpayroll_app, and each migration would need hand-written GRANTs that
--   somebody will eventually forget. These make "new table -> app can use it"
--   automatic, while still denying the app any DDL capability.
-- ============================================================================

-- Nothing is granted to the world by default.
REVOKE ALL ON SCHEMA public FROM PUBLIC;

-- The runtime role may use the schema, but may NOT create objects in it.
GRANT USAGE ON SCHEMA public TO hexpayroll_app;

-- Tables created by the migrator are automatically usable by the app role.
ALTER DEFAULT PRIVILEGES FOR ROLE hexpayroll_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO hexpayroll_app;

ALTER DEFAULT PRIVILEGES FOR ROLE hexpayroll_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO hexpayroll_app;

-- Functions (trigger functions such as hex_touch() in Phase 1).
ALTER DEFAULT PRIVILEGES FOR ROLE hexpayroll_migrator IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO hexpayroll_app;

-- Verify the runtime role cannot create anything:
--   SET ROLE hexpayroll_app; CREATE TABLE should_fail (id int);  -- must error
\echo 'Privileges applied to hexpayroll_dev.'
