# Hex Payroll — Laptop 2 Fresh Setup and Device Enrollment

**Checkpoint:** 2026-10-08  
**Target:** Fresh Windows laptop, development/test installation  
**Project directory (example):** `D:\hexpayrollsys`  
**Status:** Setup procedure; not a claim that Laptop 2 has already been connected.

> **Important:** The current sync engine transports events (`sync_outbox` → central `sync_changes` → remote `sync_inbox`) but does **not** yet apply received events to employee/payroll business tables. Do not treat a successful connection as complete data replication. Keep `SYNC_MODE=disabled` except during a controlled test.

## 0. Architecture and known identifiers

```text
Laptop 1: Electron app → local API → local PostgreSQL/payroll_sys
                                      |
                                      | HTTPS sync
                                      v
                             Permanent public HTTPS URL
                                      |
                              VPS central API (private 127.0.0.1:4311)
                                      |
                              VPS PostgreSQL (private 127.0.0.1:5433)
                                      payroll_central
                                      ^
                                      | HTTPS sync
                                      |
Laptop 2: Electron app → local API → local PostgreSQL/payroll_sys
```

- Organization: **Hexaprime Inc.**
- Canonical organization UUID: `01a10b0c-6aae-7913-90b9-479f8e0a3bca`
- Laptop 1: `laptop-mikee`; existing node UUID `01a1164a-b1f9-7f3e-8bae-d393ef0e82e0`
- Laptop 2: choose a **new** name such as `laptop-02`, with a **new** node ID and token.
- VPS deployment: `/home/hexa/hexpayrollsys/central-api`
- **Never** clone Laptop 1's local database, `.env` sync credentials, node ID or token to Laptop 2.
- **Never** expose PostgreSQL `5433` or central API `4311` to the internet. Laptop 2 uses HTTPS only; no SSH tunnel is needed for normal end-user operation.

## 1. Before starting — checklist

- [ ] Windows laptop has administrator access for software installation.
- [ ] Laptop 2 has access to the project Git repository (authorized developer setup).
- [ ] Know the exact Git branch/commit used on Laptop 1.
- [ ] PostgreSQL **18** installer is available.
- [ ] Node.js and pnpm versions match the project's `package.json` / lockfile / toolchain instructions; install Git.
- [ ] VPS central PostgreSQL and API are operational.
- [ ] A **current, working HTTPS base URL** exists (prefer a permanent, unattended endpoint).
- [ ] A secure SFTP transfer method is available **for administrator enrollment only**.

> For the eventual distributed `.exe`, the end user should not have to clone Git, run migrations manually, handle SFTP, enter VPS details, or configure SSH. This guide is for provisioning and testing the current development build.

## 2. Laptop 2 — install and inspect prerequisites

Install Git, the repository-compatible Node.js runtime and pnpm, and PostgreSQL 18. In **PowerShell**:

```powershell
git --version
node --version
pnpm --version
& "C:\Program Files\PostgreSQL\18\bin\psql.exe" --version
```

If `pnpm` is missing, follow the package manager instructions in the repository (for example, Corepack if supported by the installed Node.js version). Do **not** guess a pnpm major version.

Confirm PostgreSQL is running (service name can vary):

```powershell
Get-Service *postgres* | Format-Table Name,Status,DisplayName
```

Verify local PostgreSQL login:

```powershell
& "C:\Program Files\PostgreSQL\18\bin\psql.exe" -U postgres -h localhost -p 5432 -d postgres -c "SELECT version();"
```

Enter the **Laptop 2 local** PostgreSQL password when prompted. Port `5432` is the *example local default*; use the actual local port if different.

## 3. Laptop 2 — clone project and install dependencies

Use the authorized Git remote URL and branch (replace placeholders):

```powershell
New-Item -ItemType Directory -Force D:\ | Out-Null
Set-Location D:\
git clone <YOUR-REPOSITORY-URL> hexpayrollsys
Set-Location D:\hexpayrollsys
git checkout <YOUR-EXPECTED-BRANCH>
git rev-parse --short HEAD
pnpm install --frozen-lockfile
```

If the folder already exists, use `git status` and `git pull` **only after** confirming it has no uncommitted work. Compare the commit with Laptop 1.

Do not copy Laptop 1's `.env` or any secret files. Create Laptop 2's **own** local environment using the repo's `.env.example` / documented configuration keys. Set the local database connection for `payroll_sys` and:

```dotenv
SYNC_MODE=disabled
```

Do not place a real password or token in this document or Git.

## 4. Laptop 2 — create an empty local database

From PowerShell, using the **local** PostgreSQL instance:

```powershell
& "C:\Program Files\PostgreSQL\18\bin\psql.exe" -U postgres -h localhost -p 5432 -d postgres -c "CREATE DATABASE payroll_sys;"
```

If the database already exists, **stop** and inspect it; do not overwrite or drop it. Configure the app's local DB user/connection as required by the repository. Use a local least-privilege app role where supported; never reuse the VPS `hexpayroll_app` password.

## 5. Laptop 2 — apply local migrations and organization setup

**Do not run central bootstrap on Laptop 2.** The central database is already bootstrapped.

1. Inspect `apps/api/package.json` and the repository migration instructions to find the supported **local** migration command. The project has migration CLI artifacts (`apps/api/dist/cli/migrate.js` and `apps/api/dist/db/migrate.js`), but do not assume their arguments or directly run the central migration path.
2. Ensure the command targets **Laptop 2's** `payroll_sys`, not the VPS database.
3. Run the local migrations in order, then check the migration status according to the repository's migration system.
4. Run the project's supported **local organization initialization** workflow using the **existing** canonical UUID `01a10b0c-6aae-7913-90b9-479f8e0a3bca`. Do not generate a different organization UUID.
5. Do not import Laptop 1's `sync_nodes`, `sync_outbox`, `sync_inbox`, sync credentials, or PostgreSQL cluster.

Basic read-only checks:

```powershell
& "C:\Program Files\PostgreSQL\18\bin\psql.exe" -U postgres -h localhost -p 5432 -d payroll_sys -c "SELECT current_database();"
& "C:\Program Files\PostgreSQL\18\bin\psql.exe" -U postgres -h localhost -p 5432 -d payroll_sys -c "SELECT to_regclass('public.sync_nodes'), to_regclass('public.sync_outbox'), to_regclass('public.sync_inbox');"
```

Expected: `payroll_sys` and non-null sync table names. Confirm the organization UUID in the project's actual organization/setup table before proceeding; do not invent table/column names.

**Stop gate:** If you cannot identify the exact local migration or canonical organization initialization command from the checked-out code, stop here and verify it before proceeding. A mismatched UUID prevents enrollment.

## 6. VPS — verify central services

Administrator only, in the VPS shell:

```bash
systemctl is-active postgresql@18-main
systemctl is-active hexpayroll-central-api
curl -i http://127.0.0.1:4311/api/health
```

Expected: both services `active`; health HTTP 200 and `database: reachable`. Do not re-bootstrap `payroll_central`.

If needed:

```bash
systemctl status hexpayroll-central-api --no-pager
journalctl -u hexpayroll-central-api.service -n 50 --no-pager
```

## 7. Establish and verify the HTTPS endpoint

The previously used Cloudflare Quick Tunnel hostname was **temporary**. Do not reuse it without testing. Prefer finishing a permanent HTTPS tunnel/reverse-proxy service that survives SSH logout and reboot.

For a **temporary administrator-controlled test only**, on the VPS:

```bash
cloudflared tunnel --url http://127.0.0.1:4311
```

Keep that process alive and record its **current** HTTPS hostname privately. On Laptop 2:

```powershell
curl.exe -i "https://<CURRENT-ENDPOINT>/api/health"
```

Expected: HTTP 200 and `database: reachable`. If DNS, TLS, or health fails, **do not enroll/import against that endpoint**. `SYNC_CENTRAL_URL` must be the **base URL**, such as `https://<CURRENT-ENDPOINT>`, not the `/api/health` URL.

## 8. VPS — enroll Laptop 2 with a unique node credential

This step is performed by an **authorized administrator on the VPS**, never by the end user. Use a **new** name, e.g. `laptop-02`.

```bash
cd /home/hexa/hexpayrollsys/central-api
mkdir -p /home/hexa/hexpayrollsys-private
chmod 700 /home/hexa/hexpayrollsys-private
export SYNC_MODE=central
read -s -p "Enrollment DB password: " ENROLL_PW
echo
export CENTRAL_ENROLLMENT_DATABASE_URL="postgresql://hexpayroll_enrollment:${ENROLL_PW}@127.0.0.1:5433/payroll_central"
unset ENROLL_PW
node apps/api/dist/cli/central-node.js
```

**CLI prompts:**

```text
Confirm database name: payroll_central
Canonical organization UUID: 01a10b0c-6aae-7913-90b9-479f8e0a3bca
Action: enroll
Device name: laptop-02
New private credential file path: /home/hexa/hexpayrollsys-private/laptop-02-sync-credential.json
```

The restricted enrollment role is `hexpayroll_enrollment`; it should have only the documented minimal permissions (`CONNECT`, schema `USAGE`, `SELECT` on `application_setup`, and `SELECT/INSERT/UPDATE` on `sync_nodes`). If the password contains URL-reserved characters, use the project's approved URL-encoding/connection configuration instead of pasting it unescaped into a URL.

After the CLI finishes:

```bash
unset CENTRAL_ENROLLMENT_DATABASE_URL
unset SYNC_MODE
ls -l /home/hexa/hexpayrollsys-private/laptop-02-sync-credential.json
```

Credential file permissions should be `-rw-------`. Never `cat`, print, email, commit, or paste its contents. Record only the **new node UUID**, not its token. If enrollment partially fails, inspect node status/revocation before retrying to avoid duplicate active nodes.

## 9. Transfer one-time credential to Laptop 2

Use authenticated **SFTP** from the administrator workstation to a temporary location **outside Git**, for example:

```text
D:\hexpayrollsys-private\laptop-02-sync-credential.json
```

Create that folder on Laptop 2:

```powershell
New-Item -ItemType Directory -Force "D:\hexpayrollsys-private" | Out-Null
```

Use your trusted SFTP client to transfer the VPS file to that exact path. Avoid sharing it through email, chat, screenshots, Git, or a shared cloud folder. Do not use the old Laptop 1 credential.

## 10. Laptop 2 — import the credential locally

**Stop the desktop app and local API first.** Ensure the local DB exists, local migrations are complete, and the canonical organization UUID matches.

```powershell
Set-Location D:\hexpayrollsys
$env:SYNC_MODE="disabled"
pnpm --filter @hexpayroll/api sync:import
```

Provide the interactive answers:

```text
Local database: payroll_sys
Credential file: D:\hexpayrollsys-private\laptop-02-sync-credential.json
Central endpoint: https://<CURRENT-ENDPOINT>
```

The importer validates organization and node configuration and leaves sync disabled. If import fails, **do not** manually paste the node token into `.env` or reuse another device's credential; diagnose the error.

## 11. Remove one-time credential files and verify safely

On Laptop 2:

```powershell
Remove-Item "D:\hexpayrollsys-private\laptop-02-sync-credential.json"
Test-Path "D:\hexpayrollsys-private\laptop-02-sync-credential.json"
```

Expected: `False`. On the VPS, **only after successful import**:

```bash
rm /home/hexa/hexpayrollsys-private/laptop-02-sync-credential.json
```

Check the non-secret fields in Laptop 2's local API environment:

```powershell
Set-Location D:\hexpayrollsys
Select-String -Path "apps\api\.env" -Pattern "^(SYNC_MODE|SYNC_CENTRAL_URL|SYNC_NODE_ID)="
```

Expected structure:

```dotenv
SYNC_MODE=disabled
SYNC_CENTRAL_URL=https://<CURRENT-ENDPOINT>
SYNC_NODE_ID=<NEW-LAPTOP-2-NODE-UUID>
```

Do **not** print `SYNC_NODE_TOKEN`, full `.env`, database URLs, or secrets. Verify the local node row using the new UUID:

```powershell
& "C:\Program Files\PostgreSQL\18\bin\psql.exe" -U postgres -h localhost -p 5432 -d payroll_sys -c "SELECT id, organization_id, device_name, enabled, revoked_at FROM sync_nodes WHERE id = '<NEW-LAPTOP-2-NODE-UUID>';"
```

Expected: exactly one Laptop 2 node, correct organization, enabled, not revoked. Its node UUID **must differ** from Laptop 1's `01a1164a-b1f9-7f3e-8bae-d393ef0e82e0`.

## 12. Controlled sync transport test (not full replication)

Only after confirming HTTPS, local migration, organization, enrollment, credential import, and clean one-time file deletion:

- [ ] Take appropriate **database backups** before test writes; do not test with finalized/live payroll.
- [ ] Confirm Laptop 1 and Laptop 2 each have different node IDs/tokens.
- [ ] Confirm both local APIs are configured for their **own** `payroll_sys`.
- [ ] Confirm the permanent HTTPS endpoint is reachable from both devices.
- [ ] Set `SYNC_MODE=local` on the selected test device(s) and restart their local APIs **only for the controlled test**.
- [ ] Generate a safe test event using a supported app workflow on Laptop 1; verify its `sync_outbox` status.
- [ ] Verify the corresponding event reached central `sync_changes` (use a read-only admin query).
- [ ] Verify Laptop 2 receives it in `sync_inbox`; verify no unexpected duplicate after retry.
- [ ] Disconnect Laptop 2, confirm local app/database can still work offline, reconnect, and check queued transport behavior.
- [ ] Check errors, retry behavior, and idempotency without editing sync tables manually.
- [ ] Return `SYNC_MODE=disabled` after testing until business-table inbox application/conflict handling is implemented and approved.

**Important:** Seeing an event in Laptop 2 `sync_inbox` **does not mean** an employee/payroll record has appeared in its business tables. Business-table replication and finalized-payroll conflict protection are separate unfinished tasks.

## 13. Troubleshooting

| Symptom | Check | Safe next action |
|---|---|---|
| `psql` connection refused | Local PostgreSQL service, port, firewall | Start local PostgreSQL; verify local port |
| Database does not exist | Local `payroll_sys` | Create it once; do not drop existing data |
| Missing `sync_nodes` | Local migrations | Use repo's local migration command, not central bootstrap |
| Organization mismatch | Canonical UUID | Correct local initialization; do not enroll a second organization |
| `/api/health` fails over HTTPS | Tunnel/reverse proxy, hostname, VPS service | Repair endpoint; do not enable sync |
| Credential import fails | App stopped, correct DB, correct node credential, current URL | Inspect error without revealing token |
| Node not authorized | Enabled/revoked status and node UUID | Admin checks VPS node; never copy Laptop 1 token |
| Event in inbox but not business tables | Current implementation limitation | Expected for transport-only phase; implement inbox apply |
| Sync fails after VPS SSH closes | Quick Tunnel process stopped | Configure permanent unattended HTTPS endpoint |

## 14. Completion record

Fill in **non-secret** details after setup:

```text
Laptop 2 device name: ______________________________
Git branch / commit: _______________________________
PostgreSQL version / local port: ___________________
Local database: payroll_sys
Canonical org UUID: 01a10b0c-6aae-7913-90b9-479f8e0a3bca
Laptop 2 node UUID: ________________________________
HTTPS endpoint hostname (public, no credentials): __
VPS health: PASS / FAIL
Local migration: PASS / FAIL
Local organization check: PASS / FAIL
Credential import: PASS / FAIL
Temporary credentials removed: YES / NO
Transport push/pull test: PASS / FAIL / NOT RUN
Business-table replication: NOT YET IMPLEMENTED
Final SYNC_MODE: disabled
```

## 15. Save to Git (documentation only)

Place this file at:

```text
D:\hexpayrollsys\docs\HEX_PAYROLL_LAPTOP_2_FRESH_SETUP.md
```

From the repo root:

```powershell
git status
git add docs/HEX_PAYROLL_LAPTOP_2_FRESH_SETUP.md
git diff --cached --check
git diff --cached --stat
git commit -m "Document fresh Laptop 2 setup and secure sync enrollment"
git push
```

Before committing, inspect staged changes to ensure no `.env`, credential JSON, passwords, or tokens are included. This guide deliberately omits them.

---

**Reference checkpoint:** `docs/HEX_PAYROLL_SYNC_AND_DEVICE_SETUP.md` (2026-10-07). If actual source code, migration scripts, or CLI prompts differ, stop and reconcile this guide with the checked-out repository before executing any potentially destructive command.
