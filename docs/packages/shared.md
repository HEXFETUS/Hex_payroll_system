# `@hexpayroll/shared`

Contracts, Zod primitives and money helpers used by the API, the web app and the
desktop shell. Pure TypeScript: no I/O, no Express, no Electron, no database.

|                |                                                                         |
| -------------- | ----------------------------------------------------------------------- |
| Source         | `packages/shared/src/`                                                  |
| Build          | `tsc -p tsconfig.json` → `dist/` (ESM, `NodeNext`, declarations + maps) |
| Public surface | `src/index.ts` only — consumers never import an internal path           |

## Entry point rules (`src/index.ts`)

```ts
export * from './money.js';
```

The `.js` specifier on a `.ts` source file is deliberate and must not be "tidied away":
the package compiles with `module: NodeNext` / `moduleResolution: NodeNext`, which expects
the specifier to name the file **as it will exist after compilation**. TypeScript maps
`./money.js` → `src/money.ts`; Node resolves `./money.js` → `dist/money.js`.

`apps/api` and `packages/payroll-engine` follow the same NodeNext rule. `apps/web` uses
`moduleResolution: Bundler`, so its own relative imports stay extensionless.

## `money.ts` — money is an integer number of centavos

**Rule: every monetary value in this system is an integer number of centavos.** Floats are
never stored, summed or sent to PostgreSQL (`bigint` centavos). Binary floating point cannot
represent decimal money exactly (`0.1 + 0.2 !== 0.3`), and in payroll those errors compound
across earnings, deductions, contributions and withholding tax until payslips stop
reconciling.

| Export                                                  | Contract                                                                                                                         |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `Centavos`                                              | `number` alias; 1 peso = 100 centavos                                                                                            |
| `CENTAVOS_PER_PESO`                                     | `100`                                                                                                                            |
| `assertCentavos(value, label?)`                         | throws `RangeError` unless `Number.isSafeInteger(value)`                                                                         |
| `isCentavos(value)`                                     | type guard for the above                                                                                                         |
| `pesosToCentavos(pesos)`                                | rounds to the nearest centavo; rejects non-finite input                                                                          |
| `centavosToPesos(centavos)`                             | display/reporting only                                                                                                           |
| `addCentavos(...)`, `sumCentavos([])`                   | integer-safe addition; the total is re-asserted                                                                                  |
| `subtractCentavos(a, b)`, `multiplyCentavos(c, factor)` | `multiplyCentavos` rounds to the centavo                                                                                         |
| `allocateCentavos(total, weights)`                      | largest-remainder split where the parts sum **exactly** to `total`, ties broken by index (deterministic), sign preserved         |
| `formatPeso(centavos, locale = 'en-PH')`                | `Intl.NumberFormat` currency string, e.g. `123456` → `₱1,234.56`                                                                 |
| `centavosToDecimalString(centavos)`                     | exact decimal peso string for display/forms, e.g. `123456` → `"1234.56"`; not a centavo database parameter |
| `decimalStringToCentavos(value)`                        | parses decimal peso form input into integer centavos |

`allocateCentavos` exists because naive per-part rounding silently loses or invents centavos.
Use it whenever a total is divided — a pay-run pot across days worked, a contribution across
periods — so the payslip still reconciles to the control total.

## `primitives.ts` — validation written once

Shared by the API (inbound request validation) and the clients (form validation). Only
long-stable Zod APIs are used deliberately: these schemas sit on the boundary of every
request, so they must not depend on recently renamed helpers.

| Schema                      | Rule                                                 |
| --------------------------- | ---------------------------------------------------- |
| `uuidSchema`                | UUID text; payroll rows use PostgreSQL 18 `uuidv7()` |
| `centavosSchema`            | `Number.isSafeInteger` — a whole number of centavos  |
| `nonNegativeCentavosSchema` | `centavosSchema` plus `>= 0`                         |
| `isoDateSchema`             | calendar date, `YYYY-MM-DD`, no time component       |
| `nonEmptyTrimmedString`     | trimmed string with at least one character           |

Types `Uuid` and `IsoDate` are inferred from the schemas.

## `health.ts` — the Phase 0 end-to-end contract

`HealthStatus` (produced by the API, consumed by the clients) plus the `HEALTH_PATH`
constant:

| Field              | Meaning                                                                                     |
| ------------------ | ------------------------------------------------------------------------------------------- |
| `status`           | `'ok' \| 'error'`                                                                           |
| `database`         | `'reachable' \| 'unreachable'` — a real query reached PostgreSQL, not merely a live process |
| `databaseVersion?` | which PostgreSQL server answered; matters once central sync exists                          |
| `timestamp`        | ISO timestamp produced by the API                                                           |
| `error?`           | present only on the error variant                                                           |

`healthStatusSchema` validates the discriminated readiness response at runtime.
`parseHealthResponse` also checks that HTTP 200 matches reachable readiness and
HTTP 503 matches an unreachable database. Error responses contain only the fixed
message `Database readiness check failed`; database names, roles, and driver errors
are not exposed by the endpoint.

## Consuming it from the browser

`src/index.ts` re-exports everything with `export *`, so importing the package root from
`apps/web` pulls the Zod-based `primitives` module into the client bundle (measured: 17 zod
modules inside `apps/web/dist`). Phase 2 candidate: publish subpath exports
(`@hexpayroll/shared/money`, `…/health`) so the browser build only takes what it uses.
