# Hex Payroll — Central Sync & Device Connection Setup

**Status:** 2026-10-07  
**Project:** Hex Payroll System

> **Security:** Never commit passwords, node tokens, credential JSON files, secret `.env` values, PostgreSQL connection strings containing passwords, or SSH credentials to Git.

## 1. Locked Architecture

Hex Payroll is an **offline-first Windows desktop application**. Each authorized PC has its own local PostgreSQL database (`payroll_sys`) and remains usable without internet. When online, it communicates with the central VPS through an HTTPS synchronization API.

```text
Windows PC -> Local API -> PostgreSQL payroll_sys
                  |
                  | HTTPS when online
                  v
          Public HTTPS endpoint
                  |
                  v
       Central API 127.0.0.1:4311
                  |
                  v
 PostgreSQL 127.0.0.1:5433 / payroll_central
```

Desktop installations **must not connect directly to central PostgreSQL** and must never receive VPS PostgreSQL, migration, enrollment, bootstrap, or SSH credentials. Each device receives only its own unique sync node ID and node token.

## 2. Current VPS Setup

- Ubuntu 24.04.4 LTS, x86_64
- Deployment: `/home/hexa/hexpayrollsys/central-api`
- PostgreSQL 18.6, database `payroll_central`
- PostgreSQL: `127.0.0.1:5433`
- Central API: `127.0.0.1:4311`
- Runtime DB role: `hexpayroll_app`
- PostgreSQL and API ports remain private; do not expose `4311` or `5433` publicly.

Persistent services:

```bash
systemctl is-active postgresql@18-main
systemctl is-active hexpayroll-central-api
```

Both should return `active`.

Central API service: `/etc/systemd/system/hexpayroll-central-api.service`

```ini
[Unit]
Description=Hex Payroll Central API
After=network-online.target postgresql@18-main.service
Wants=network-online.target
Requires=postgresql@18-main.service

[Service]
Type=simple
User=hexa
Group=hexa
WorkingDirectory=/home/hexa/hexpayrollsys/central-api/apps/api
ExecStart=/usr/bin/node dist/server.js
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

Useful commands:

```bash
sudo systemctl restart hexpayroll-central-api
systemctl status hexpayroll-central-api --no-pager
journalctl -u hexpayroll-central-api.service -n 50 --no-pager
curl -i http://127.0.0.1:4311/api/health
```

Expected health: HTTP 200 with `"database":"reachable"`.

## 3. Canonical Organization

```text
Organization: Hexaprime Inc.
UUID: 01a10b0c-6aae-7913-90b9-479f8e0a3bca
```

Central bootstrap is complete. **Do not bootstrap the existing central database again.** Every participating local installation must use this same canonical organization UUID.

## 4. Current First Device

```text
Device: laptop-mikee
Node ID: 01a1164a-b1f9-7f3e-8bae-d393ef0e82e0
Organization: 01a10b0c-6aae-7913-90b9-479f8e0a3bca
Local DB: payroll_sys
SYNC_MODE: disabled
```

The node is enabled centrally and locally. Its one-time credential was imported successfully and the temporary JSON was deleted from Windows and the VPS.

## 5. HTTPS Endpoint — Current Test State

The initial test used a Cloudflare Quick Tunnel:

```bash
cloudflared tunnel --url http://127.0.0.1:4311
```

It generates a temporary `https://<random>.trycloudflare.com` URL. A Quick Tunnel stops when its process stops and may get a different hostname after restart. Therefore the previously configured URL must not be assumed valid tomorrow.

For production, replace it with a **permanent HTTPS endpoint** that runs independently of SSH:

```text
Windows PCs -> HTTPS -> permanent endpoint -> cloudflared/reverse proxy
                                            -> 127.0.0.1:4311 API
                                            -> 127.0.0.1:5433 PostgreSQL
```

## 6. Sync Transport

Each PC has its own local database. Offline work is stored locally and synchronization changes are queued in `sync_outbox`.

```text
PC1 sync_outbox -> PUSH/HTTPS -> central sync_changes
central sync_changes -> PULL/HTTPS -> PC2 sync_inbox
```

Every PC gets a different node ID and token. **Never copy one device's node credential to another device.**

### Current limitation

Phase 4 currently proves transport only. Pulled events reach `sync_inbox` but are **not yet automatically applied to employee/payroll business tables**. Full business-data replication still requires inbox application, revision/conflict handling, and finalized-payroll protection.

## 7. Connect a New Laptop / Device

### A. Prepare the new PC

The new PC needs Hex Payroll, PostgreSQL 18, its own `payroll_sys`, required migrations, the canonical organization UUID, and `SYNC_MODE=disabled`. Stop the local API/app during credential import.

### B. Verify VPS

```bash
systemctl is-active postgresql@18-main
systemctl is-active hexpayroll-central-api
curl -i http://127.0.0.1:4311/api/health
```

### C. Establish HTTPS

For another temporary test:

```bash
cloudflared tunnel --url http://127.0.0.1:4311
```

From Windows:

```powershell
curl.exe -i "https://<CURRENT-TUNNEL>.trycloudflare.com/api/health"
```

Require HTTP 200 and `database: reachable` before proceeding.

### D. Prepare restricted enrollment environment

Enrollment role: `hexpayroll_enrollment`.

Required privileges only:

```text
payroll_central: CONNECT
public schema: USAGE
application_setup: SELECT
sync_nodes: SELECT, INSERT, UPDATE
```

No business-table access, DELETE, DDL, superuser, CREATEDB, or CREATEROLE.

Set credentials privately:

```bash
export SYNC_MODE=central
read -s -p "Enrollment DB password: " ENROLL_PW
echo
export CENTRAL_ENROLLMENT_DATABASE_URL="postgresql://hexpayroll_enrollment:${ENROLL_PW}@127.0.0.1:5433/payroll_central"
unset ENROLL_PW
```

Never print the full enrollment URL.

### E. Enroll the device

From `/home/hexa/hexpayrollsys/central-api`:

```bash
node apps/api/dist/cli/central-node.js
```

Example:

```text
Confirm database name: payroll_central
Canonical organization UUID: 01a10b0c-6aae-7913-90b9-479f8e0a3bca
Action: enroll
Device name: office-pc-01
New private credential file path: /home/hexa/hexpayrollsys-private/office-pc-01-sync-credential.json
```

Use a private directory outside the repository:

```bash
mkdir -p /home/hexa/hexpayrollsys-private
chmod 700 /home/hexa/hexpayrollsys-private
```

Credential files should be `-rw-------`. **Never `cat` them.** If delivery fails after node creation, do not blindly retry; check whether the new node was automatically revoked first.

### F. Clear enrollment credentials

```bash
unset CENTRAL_ENROLLMENT_DATABASE_URL
unset SYNC_MODE
```

### G. Securely transfer credential

Transfer the JSON via authenticated SFTP to a temporary Windows location outside Git, e.g.:

```text
D:\hexpayrollsys-private\office-pc-01-sync-credential.json
```

Do not open, edit, paste, email, or commit it.

### H. Import locally

From the new PC's repository root with the local API stopped:

```powershell
$env:SYNC_MODE="disabled"
pnpm --filter @hexpayroll/api sync:import
```

Provide:

```text
Local database: payroll_sys
Credential file: D:\hexpayrollsys-private\office-pc-01-sync-credential.json
Central endpoint: https://<CURRENT-ENDPOINT>
```

Use the HTTPS **base URL**, not `/api/health`. Import validates the organization/node and intentionally leaves `SYNC_MODE=disabled`.

### I. Delete the one-time credential

Windows:

```powershell
Remove-Item "D:\hexpayrollsys-private\office-pc-01-sync-credential.json"
Test-Path "D:\hexpayrollsys-private\office-pc-01-sync-credential.json"
```

Expected: `False`.

VPS:

```bash
rm /home/hexa/hexpayrollsys-private/office-pc-01-sync-credential.json
```

### J. Verify without exposing token

```powershell
Select-String -Path "apps\api\.env" `
  -Pattern "^(SYNC_MODE|SYNC_CENTRAL_URL|SYNC_NODE_ID)="
```

Expected structure:

```text
SYNC_MODE=disabled
SYNC_CENTRAL_URL=https://<CURRENT-ENDPOINT>
SYNC_NODE_ID=<UNIQUE-NODE-UUID>
```

Verify local DB node:

```powershell
& "C:\Program Files\PostgreSQL\18\bin\psql.exe" `
  -U postgres -h localhost -d payroll_sys `
  -c "SELECT id, organization_id, device_name, enabled, revoked_at FROM sync_nodes WHERE id = '<NODE-UUID>';"
```

### K. Enable sync only when ready

Before changing to `SYNC_MODE=local`, verify central PostgreSQL, central API, HTTPS endpoint, enrolled node, local credential import, deleted temporary credential files, and the currently configured URL.

Only then change:

```text
SYNC_MODE=disabled
```

to:

```text
SYNC_MODE=local
```

and restart the local API.

## 8. Multiple PCs

Repeat enrollment independently for every installation:

```text
laptop-mikee   -> node A / token A
office-pc-01   -> node B / token B
payroll-pc-02  -> node C / token C
```

They may share the same organization UUID, but they must never share node credentials or cloned sync `.env` values.

## 9. Revoke a Lost/Retired Device

Run:

```bash
node apps/api/dist/cli/central-node.js
```

Choose `revoke`, then provide the canonical organization UUID and target node UUID. Revocation disables future token authentication while retaining identity/history.

## 10. Resume Point — 2026-10-07

```text
CENTRAL VPS
PostgreSQL 18 / payroll_central       READY
PostgreSQL systemd                    READY
Central API                           READY
Central API systemd                   READY
Canonical organization                READY
Central bootstrap                     COMPLETE
Restricted enrollment role            READY
laptop-mikee node                     ENROLLED
Permanent HTTPS endpoint              NOT YET CONFIGURED

LOCAL laptop-mikee
PostgreSQL / payroll_sys              READY
Canonical organization                READY
Node credential                       IMPORTED
Temporary credential files            DELETED
SYNC_MODE                              disabled
Transport push/pull test              NOT YET COMPLETED
Business-table replication            NOT YET IMPLEMENTED
```

### Next session

1. Establish/verify a working HTTPS endpoint; preferably replace Quick Tunnel with a permanent unattended endpoint.
2. Verify public `/api/health`.
3. Verify/update local `SYNC_CENTRAL_URL`.
4. Enable `SYNC_MODE=local` only for the controlled transport test.
5. Test PC1 `sync_outbox` -> central `sync_changes`.
6. Enroll/setup the second PC independently using this guide.
7. Test central `sync_changes` -> PC2 `sync_inbox`.
8. Verify retries/idempotency.
9. Implement business-table inbox application separately.

## 11. Non-Negotiable Rules

- VPS PostgreSQL `5433` stays loopback-only.
- Central API `4311` stays loopback-only.
- PCs communicate with central over HTTPS only.
- Never put central PostgreSQL credentials in the desktop app.
- Never reuse node credentials between devices.
- Never commit credential JSON files or secret `.env` values.
- Delete one-time credentials after successful import.
- Keep `SYNC_MODE=disabled` until endpoint/device configuration is verified.
- Quick Tunnel URLs are temporary.
- Schema migration and data synchronization are separate concerns.
- Current transport does not yet apply pulled events to business tables.
- Finalized payroll must never be silently overwritten by future replication logic.
