# Hex Payroll — VPS Setup and Multi-Device Connection Guide

**Checkpoint:** 2026-10-08  
**Scope:** Ubuntu VPS central synchronization server, existing-server checks, and onboarding additional Windows laptops.

> **Important:** The current VPS is already working. Laptop 1 (`laptop-mikee`) successfully pushed an organization event to the central database and pulled it back into its local inbox. **Do not rebuild or reset the VPS just to connect Laptop 2.** This guide separates fresh-server planning from the safe existing-server workflow.

## 1. Locked architecture

- Each Windows laptop runs the Hex Payroll desktop application and its **own local PostgreSQL 18** database (`payroll_sys`) for offline work.
- The VPS permanently hosts **central PostgreSQL 18** (`payroll_central`) and only the **minimal central synchronization/API service**.
- Laptop clients communicate with the VPS **through HTTPS**, never through direct PostgreSQL connections or end-user SSH tunnels.
- The VPS is not a deployment target for the desktop UI or full development repository.
- Current sync implementation transports events: local `sync_outbox` → central `sync_changes` → local `sync_inbox`. **It does not yet apply incoming events to business tables or provide full employee/payroll replication.** Conflict/revision handling and finalized-payroll protections still need implementation.

```text
Windows Laptop 1                       Ubuntu VPS                        Windows Laptop 2
Hex Payroll + PostgreSQL 18            Cloudflare HTTPS tunnel           Hex Payroll + PostgreSQL 18
payroll_sys                             Central API (127.0.0.1:4311)     payroll_sys
      \____________ HTTPS _____________/    |    \____________ HTTPS _____________/
                                             PostgreSQL 18
                                             payroll_central
                                             (127.0.0.1:5433)
```

## 2. Known working configuration (2026-10-08)

| Component | Configuration |
|---|---|
| VPS login account | `hexa` |
| VPS deployment directory | `/home/hexa/hexpayrollsys/central-api` |
| Central PostgreSQL cluster | `postgresql@18-main` |
| Central PostgreSQL database | `payroll_central` |
| Central PostgreSQL address | `127.0.0.1:5433` |
| Central API address | `127.0.0.1:4311` |
| Central API service | `hexpayroll-central-api` |
| Cloudflare tunnel service | `hexpayroll-cloudflared` |
| Last verified Quick Tunnel URL | `https://ceo-priest-teach-tray.trycloudflare.com` |
| Organization ID | `01a10b0c-6aae-7913-90b9-479f8e0a3bca` |
| Laptop 1 name | `laptop-mikee` |
| Laptop 1 node ID | `01a1164a-b1f9-7f3e-8bae-d393ef0e82e0` |
| Laptop 1 local DB | `payroll_sys` |

**Quick Tunnel warning:** `trycloudflare.com` URLs are temporary and may change when the service restarts. Check the current URL before configuring each laptop. A Quick Tunnel is appropriate for development/testing, not a reliable production endpoint.

### Verified transport checkpoint

- Laptop 1 organization `CREATE` event ID: `01a10b0c-6abb-7a2b-acf4-f4bc74d9dc35`.
- Laptop 1 outbox status: `synced`, `attempt_count=1`, `central_sequence=2`.
- Central `sync_changes`: matching event at sequence `2`.
- Laptop 1 `sync_inbox`: matching event at sequence `2`.
- Laptop 1 `sync_nodes.last_pull_sequence`: `2`.

## 3. Existing VPS: verify before connecting another laptop (recommended)

SSH to the VPS from an authorized administrator machine:

```bash
ssh hexa@YOUR_VPS_IP
```

Check OS, PostgreSQL cluster, and service status:

```bash
lsb_release -a
pg_lsclusters
systemctl is-active postgresql@18-main
systemctl is-active hexpayroll-central-api
systemctl is-active hexpayroll-cloudflared
```

Confirm the central database exists:

```bash
sudo -u postgres psql -p 5433 -l
```

Confirm the API is healthy locally on the VPS:

```bash
curl -i http://127.0.0.1:4311/api/health
```

Expected: HTTP `200` and JSON containing `"status":"ok"` and `"database":"reachable"`.

Find the current Cloudflare HTTPS URL:

```bash
sudo journalctl -u hexpayroll-cloudflared -n 60 --no-pager
```

Test the URL from the Windows laptop (replace the example if the tunnel changed):

```powershell
curl.exe -i "https://ceo-priest-teach-tray.trycloudflare.com/api/health"
```

**Do not reinstall PostgreSQL, drop `payroll_central`, regenerate organization identity, or rerun bootstrap on the working VPS.**

## 4. Fresh VPS setup — installation checklist

Use this section **only for a genuinely new VPS** or a deliberate disaster-recovery rebuild with verified backups. Some project-specific commands depend on the current repository scripts and must be checked rather than guessed.

### Step 4.1 — Prepare Ubuntu

Target: Ubuntu 24.04 LTS, a non-root administrative account, SSH key access, OS updates, and a firewall. Allow SSH access for administrators; **do not expose PostgreSQL or the internal central API directly**.

```bash
lsb_release -a
whoami
sudo apt update
sudo apt upgrade
```

### Step 4.2 — Install PostgreSQL 18

Install PostgreSQL 18 using the official PostgreSQL APT repository instructions for the VPS OS, then verify:

```bash
psql --version
pg_lsclusters
```

The established Hex Payroll central cluster uses **port 5433** and listens only on loopback. On a clean VPS, PostgreSQL 18 may initially use a different port: explicitly configure and verify the intended port before continuing. Do not assume an existing PostgreSQL 16 cluster or port layout on a new machine.

```bash
sudo systemctl status postgresql@18-main
```

### Step 4.3 — Provision central database and roles

Provision `payroll_central`, dedicated least-privilege application credentials, the central schema, and organization bootstrap using the **current Hex Payroll project migration/bootstrap procedures**. Do not copy credentials from another server or invent SQL table definitions.

Before executing bootstrap, inspect the scripts and confirm whether they are safe to rerun. The known organization ID for the established environment is:

```text
01a10b0c-6aae-7913-90b9-479f8e0a3bca
```

A newly rebuilt server intended to replace the existing one must preserve the required central data and device enrollment state through a validated restore plan. A blank database with a new identity is **not** a seamless replacement for the current VPS.

Verify:

```bash
sudo -u postgres psql -p 5433 -l
```

### Step 4.4 — Deploy the minimal central API

Established deployment directory:

```text
/home/hexa/hexpayrollsys/central-api
```

Deploy only the central API's runtime bundle and required dependencies, not the desktop frontend or full development repository. Configure the central API with `SYNC_MODE=central`, its own central database connection settings, and loopback binding `127.0.0.1:4311`. Keep environment files and secrets out of Git.

**Service startup paths are build-dependent.** Inspect the actual deployed layout and Node.js binary location before writing `ExecStart`; do not assume they match another server.

An illustrative systemd unit (adjust paths only after verifying them):

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

[Install]
WantedBy=multi-user.target
```

Save to `/etc/systemd/system/hexpayroll-central-api.service` only after confirming the correct runtime paths. Then:

```bash
sudo systemd-analyze verify /etc/systemd/system/hexpayroll-central-api.service
sudo systemctl daemon-reload
sudo systemctl enable --now hexpayroll-central-api
systemctl is-active hexpayroll-central-api
curl -i http://127.0.0.1:4311/api/health
```

If the health check fails, inspect logs without publishing secrets:

```bash
sudo journalctl -u hexpayroll-central-api -n 80 --no-pager
```

### Step 4.5 — Set up a Cloudflare Quick Tunnel for testing

Install the appropriate official `cloudflared` release for the VPS architecture and verify its location/version:

```bash
/usr/local/bin/cloudflared --version
```

Create `/etc/systemd/system/hexpayroll-cloudflared.service`:

```ini
[Unit]
Description=Hex Payroll Cloudflare Quick Tunnel
After=network-online.target hexpayroll-central-api.service
Wants=network-online.target
Requires=hexpayroll-central-api.service

[Service]
Type=simple
User=hexa
Group=hexa
ExecStart=/usr/local/bin/cloudflared tunnel --no-autoupdate --url http://127.0.0.1:4311
Restart=always
RestartSec=10
TimeoutStopSec=15

[Install]
WantedBy=multi-user.target
```

Start and verify:

```bash
sudo systemd-analyze verify /etc/systemd/system/hexpayroll-cloudflared.service
sudo systemctl daemon-reload
sudo systemctl enable --now hexpayroll-cloudflared
systemctl is-active hexpayroll-cloudflared
sudo journalctl -u hexpayroll-cloudflared -n 60 --no-pager
```

The logs should show a temporary `https://...trycloudflare.com` address. Test `/api/health` from a laptop over HTTPS. **The API is reachable publicly through this URL**: authentication, input validation, and rate limiting remain important. For production, use a stable, managed HTTPS hostname and appropriate access controls.

## 5. Connect Laptop 2 to the existing VPS

### Step 5.1 — Prepare Laptop 2

Install/verify Windows prerequisites (Node.js, pnpm, Git, PostgreSQL 18), obtain the current project code, and provision a **separate** local `payroll_sys` database using project migrations.

PowerShell checks:

```powershell
node --version
pnpm --version
git --version
& "C:\Program Files\PostgreSQL\18\bin\psql.exe" --version
Test-Path "D:\hexpayrollsys"
```

### Step 5.2 — Enroll a new device on the VPS

Use the existing central node enrollment CLI and its actual help/source to confirm required arguments before running it:

```bash
cd /home/hexa/hexpayrollsys/central-api
node apps/api/dist/cli/central-node.js
```

**Do not assume invoking the CLI without arguments is harmless**; inspect its source/help first. Create a unique device identity for Laptop 2 under the existing organization. Do not reuse Laptop 1's node ID or token. Handle enrollment output as a secret.

### Step 5.3 — Import Laptop 2 credentials safely

On Laptop 2, stop the local API and set `SYNC_MODE=disabled` before import. The established project includes:

```powershell
cd D:\hexpayrollsys
pnpm --filter @hexpayroll/api sync:import
```

Follow the import CLI's exact prompts and supported input format. Transfer credentials through a secure channel, keep them out of Git and chat logs, and delete temporary credential exports after verified import.

Laptop 2's local API `.env` should eventually contain **its own** node ID and token, the **current** central HTTPS URL, and `SYNC_MODE=disabled` until enrollment is verified.

Example **non-secret** settings:

```dotenv
SYNC_MODE=disabled
SYNC_CENTRAL_URL=https://CURRENT-TUNNEL.trycloudflare.com
SYNC_INTERVAL_MS=15000
```

Do not copy Laptop 1's `.env`, node ID, or token.

### Step 5.4 — Test Laptop 2 safely

1. Confirm its `sync_nodes` row is enabled and not revoked.
2. Confirm `/api/health` over HTTPS from Laptop 2.
3. Inspect local `sync_outbox` before starting the worker.
4. Review pending event types and central duplicates.
5. Change `SYNC_MODE=local` only when ready for a controlled test.
6. Start the local API with `pnpm --filter @hexpayroll/api dev` (from the project root) and inspect logs.
7. Verify outbox receipts, central `sync_changes`, local `sync_inbox`, and `last_pull_sequence`.

**Remember:** A successful push/pull test proves event transport, **not** business-table replication across devices.

## 6. Operational commands

On VPS:

```bash
systemctl is-active postgresql@18-main
systemctl is-active hexpayroll-central-api
systemctl is-active hexpayroll-cloudflared
curl -i http://127.0.0.1:4311/api/health
sudo journalctl -u hexpayroll-central-api -n 50 --no-pager
sudo journalctl -u hexpayroll-cloudflared -n 50 --no-pager
```

Read-only central event check (example known event):

```bash
sudo -u postgres psql -p 5433 -d payroll_central -c "SELECT sequence, source_node_id, source_event_id, entity_type, operation, revision FROM sync_changes WHERE source_event_id='01a10b0c-6abb-7a2b-acf4-f4bc74d9dc35';"
```

On Laptop 1 PowerShell:

```powershell
& "C:\Program Files\PostgreSQL\18\bin\psql.exe" -U postgres -h localhost -d payroll_sys -c "SELECT id, status, attempt_count, central_sequence, synced_at, error FROM sync_outbox ORDER BY created_at;"
& "C:\Program Files\PostgreSQL\18\bin\psql.exe" -U postgres -h localhost -d payroll_sys -c "SELECT sequence, source_event_id, entity_type, operation FROM sync_inbox ORDER BY sequence;"
```

## 7. Security and Git checklist

- Never commit `.env`, node tokens, database passwords, enrollment exports, or SSH private keys.
- Keep central PostgreSQL and the central API on `127.0.0.1`.
- Give every laptop unique enrollment credentials.
- Back up the central database before any VPS rebuild, schema change, or restore.
- Use the Cloudflare Quick Tunnel for testing only; its URL may change.
- Do not claim full employee/payroll replication until business-record application and conflict controls are implemented and tested.

## 8. Recommended next action for this project

**Reuse the verified VPS and enroll Laptop 2.** Start with these VPS checks and share their outputs before changing anything:

```bash
pg_lsclusters
systemctl is-active postgresql@18-main
systemctl is-active hexpayroll-central-api
systemctl is-active hexpayroll-cloudflared
curl -i http://127.0.0.1:4311/api/health
```
