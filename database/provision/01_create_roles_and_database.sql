-- ============================================================================
-- Hex Payroll — Step 1 of 2: create the two roles and the database.
--
-- Run this ONCE, as a PostgreSQL superuser (typically `postgres`), connected to
-- the maintenance database `postgres`:
--
--   psql -h 127.0.0.1 -U postgres -d postgres -f database/provision/01_create_roles_and_database.sql
--
-- Then run 02_grant_app_privileges.sql against the new database.
--
-- WHY TWO ROLES
--   hexpayroll_migrator : owns the schema; the ONLY role that may run DDL.
--   hexpayroll_app      : the runtime role used by Express. DML only.
-- A payroll application that cannot silently alter its own schema is a real
-- safety property. Schema evolution becomes a deliberate, auditable act.
--
-- SECURITY NOTE
--   The passwords below are LOCAL DEVELOPMENT ONLY. For any shared, staging or
--   production database, replace them and keep them out of version control.
-- ============================================================================

CREATE ROLE hexpayroll_migrator LOGIN PASSWORD 'hxp_dev_mig_8f3a91c4d2e7';
CREATE ROLE hexpayroll_app      LOGIN PASSWORD 'hxp_dev_app_5b7e20d9a6f1';

-- The migrator owns the database. On PostgreSQL 15+, the `public` schema is
-- owned by `pg_database_owner`, so database ownership is what grants the
-- migrator its DDL rights without weakening `public` for every role globally.
CREATE DATABASE hexpayroll_dev OWNER hexpayroll_migrator;

\echo 'Roles and database created. Now run 02_grant_app_privileges.sql against hexpayroll_dev.'
