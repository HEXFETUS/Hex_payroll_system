# Hex Payroll central runtime

This package contains the compiled API, shared contracts, payroll engine, and a
production-only pnpm workspace/lockfile. It contains no installed dependencies,
desktop application, frontend, real environment file, development source, tests,
or migration tooling. PostgreSQL migrations through 0031 must already be applied
and verified separately. This runtime package does not apply migrations.

## Linux installation

Use Node.js 22.12 or later and pnpm 11.2.2. Extract into a new release directory
owned by the intended service user. From the extracted `central-api-linux`
directory, install production dependencies **on Linux**:

```sh
pnpm install --prod --frozen-lockfile --ignore-scripts
```

The workspace resolves both `@hexpayroll` packages locally. There is no root
Electron postinstall and no dependency compilation step. Do not reuse Windows
`node_modules`, run `pnpm build`, or copy your desktop `.env` to the VPS.

Create the VPS environment file without printing its password in the terminal:

```sh
cp apps/api/.env.example apps/api/.env
chmod 600 apps/api/.env
```

Edit that file locally on the VPS and replace `CHANGE_ME`. It must connect as the
restricted runtime role to `127.0.0.1:5433/payroll_central`. Do not provide migration
credentials or any installation token. The API binds only to `127.0.0.1:4311`.

Start the API in the foreground for the initial check:

```sh
pnpm start
```

In a second VPS terminal:

```sh
curl --fail --silent --show-error http://127.0.0.1:4311/api/health
```

Expected: HTTP 200 with `status:"ok"` and `database:"reachable"`. An authenticated
loopback database probe confirms connectivity; it does not verify all schema
constraints, runtime grants, node permissions, or the transport protocol.

Run enrollment/push/pull tests against disposable data before enabling actual
desktop installations. Devices must share the correct organization UUID; Phase
4A does not bootstrap organizations or replicate business tables. A delivered
event is a transport receipt only.

After initial verification, configure a persistent service and an HTTPS reverse
proxy. Keep ports 4311 and 5433 private. The service's working directory must be
`<release>/central-api-linux/apps/api`, because dotenv resolves `.env` there.
Its start command is `node dist/server.js`. Running `pnpm start` from the release
root also sets the correct package working directory.

Desktop sync remains disabled until the HTTPS endpoint and transport tests pass.
This artifact preparation does not upload anything, start a VPS process, edit its
database, or change desktop configuration.
