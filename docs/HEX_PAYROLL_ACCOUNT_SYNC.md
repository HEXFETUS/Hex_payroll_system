# Account event transport to the VPS

New accounts created by `createAuthService().createUser()` now enqueue an
`auth_users` snapshot in the same transaction as account creation and the
default role assignment. A failure to queue rolls back account creation.

For an existing account, run from the repository root:

```powershell
pnpm --filter @hexpayroll/api sync:user
```

Confirm the local database name and enter the existing username when prompted.
The command queues only that account; it does not start synchronization or change
the synchronization mode. With a configured and enrolled local worker running
in `SYNC_MODE=local`, the existing transport delivers pending events to the VPS.
Requeueing an unchanged revision preserves the event and receipt. A changed
snapshot at the same revision is rejected instead of overwriting history.

Verify using metadata only, without selecting the payload:

```sql
SELECT id, entity_id, revision, status, central_sequence, synced_at
FROM sync_outbox WHERE entity_type='auth_users';
```

On the VPS, check the resulting event ID in `sync_changes`:

```sql
SELECT sequence, source_event_id, entity_id, entity_type, operation, revision
FROM sync_changes WHERE source_event_id='<ACCOUNT-EVENT-ID>';
```

Snapshots contain the user identity, organization, salted scrypt password
verifier, active status, timestamps, revision, and assigned role codes.
They exclude plaintext passwords, sessions, access tokens and login activity.
Password verifiers remain sensitive: do not print sync payloads or commit
database exports. Custom role definitions and permissions are not exported.

The local worker now applies downloaded `auth_users` snapshots to local
PostgreSQL, including password verifiers, active status and assigned role codes.
Existing pending inbox events (including sequence 10) are processed without
resending them or resetting the pull cursor. The VPS remains the event transport.

Deployment on each laptop:

```powershell
git pull
pnpm install --frozen-lockfile
pnpm --filter @hexpayroll/api migrate
```

Restart the application with the existing enrolled `SYNC_MODE=local` settings.
Migration 0032 adds receiver diagnostics. No reenrollment or database reset is
required. Git distributes code; payroll data travels through the VPS, and local
database files or dumps must not be committed to Git.

Each event and its receipt are applied transactionally. Older revisions are
acknowledged without replacing newer local data; identical revisions are
acknowledged only if the snapshots match. Conflicting revisions, unavailable
roles, identity mismatches and local uniqueness violations remain pending for
review. A failed account event blocks later account events in that installation
until corrected; unsupported entity types remain pending for future handlers.
Custom roles must already exist locally with the intended permissions.
Account updates invalidate existing local sessions and never enqueue an echo.

Inspect application progress without reading sensitive payloads:

```sql
SELECT sequence, entity_type, entity_id, revision, applied_at,
       apply_attempt_count, last_apply_attempt_at, apply_error
FROM sync_inbox ORDER BY sequence;
```

Employees, attendance and other business entities still need dedicated receivers.
This change receives account updates; outgoing password/status/role mutation
paths must enqueue a snapshot and increment the revision when added.
