<#
.SYNOPSIS
    Provisions the Hex Payroll development database (roles, database, privileges).

.DESCRIPTION
    Runs the two committed SQL files in order and then verifies the result:

      01_create_roles_and_database.sql  -> hexpayroll_migrator, hexpayroll_app, hexpayroll_dev
      02_grant_app_privileges.sql       -> DML for the app role, no DDL

    Finally it asserts the important safety property: that the runtime role
    genuinely CANNOT create tables.

    Requires a PostgreSQL superuser (default: postgres). The password is read as a
    SecureString and only ever placed in $env:PGPASSWORD for the duration of the run.

    The SQL files remain the source of truth; this script just drives them.

.EXAMPLE
    .\provision.ps1

.EXAMPLE
    .\provision.ps1 -SuperUser postgres -DbHost 127.0.0.1 -Port 5432
#>
[CmdletBinding()]
param(
    [string] $SuperUser = 'postgres',
    [string] $DbHost = '127.0.0.1',
    [int]    $Port = 5432,
    [string] $PsqlPath = 'C:\Program Files\PostgreSQL\18\bin\psql.exe'
)

# Native commands writing to stderr must not become terminating errors here;
# we rely on $LASTEXITCODE instead.
$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$step1 = Join-Path $scriptDir '01_create_roles_and_database.sql'
$step2 = Join-Path $scriptDir '02_grant_app_privileges.sql'
$envFile = Join-Path $scriptDir '..\..\apps\api\.env'

function Write-Step([string] $Message) { Write-Host "`n==> $Message" -ForegroundColor Cyan }
function Write-Ok([string] $Message)   { Write-Host "    OK  $Message" -ForegroundColor Green }
function Write-Bad([string] $Message)  { Write-Host "    !!  $Message" -ForegroundColor Red }

# --- preconditions -----------------------------------------------------------

if (-not (Test-Path -LiteralPath $PsqlPath)) {
    $onPath = Get-Command psql -ErrorAction SilentlyContinue
    if ($onPath) {
        $PsqlPath = $onPath.Source
    } else {
        Write-Bad "psql not found at '$PsqlPath' and not on PATH. Pass -PsqlPath."
        exit 1
    }
}

foreach ($file in @($step1, $step2)) {
    if (-not (Test-Path -LiteralPath $file)) {
        Write-Bad "Missing SQL file: $file"
        exit 1
    }
}

Write-Host "Hex Payroll - database provisioning" -ForegroundColor White
Write-Host "  psql        : $PsqlPath"
Write-Host "  server      : ${DbHost}:${Port}"
Write-Host "  superuser   : $SuperUser"

$securePassword = Read-Host -Prompt "Password for superuser '$SuperUser'" -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
try {
    $env:PGPASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
}

try {
    # --- step 1: roles + database --------------------------------------------
    Write-Step 'Step 1/2 - creating roles and database'
    & $PsqlPath -h $DbHost -p $Port -U $SuperUser -d postgres -w -v ON_ERROR_STOP=1 -f $step1
    if ($LASTEXITCODE -ne 0) {
        Write-Bad "Step 1 failed (exit $LASTEXITCODE)."
        Write-Host '    If the roles already exist, either drop them first or skip to step 2.' -ForegroundColor Yellow
        exit $LASTEXITCODE
    }
    Write-Ok 'roles and database created'

    # --- step 2: privileges --------------------------------------------------
    Write-Step 'Step 2/2 - applying the privilege model to hexpayroll_dev'
    & $PsqlPath -h $DbHost -p $Port -U $SuperUser -d hexpayroll_dev -w -v ON_ERROR_STOP=1 -f $step2
    if ($LASTEXITCODE -ne 0) {
        Write-Bad "Step 2 failed (exit $LASTEXITCODE)."
        exit $LASTEXITCODE
    }
    Write-Ok 'privileges applied'

    # --- verification --------------------------------------------------------
    Write-Step 'Verifying'

    # Reuse the runtime credentials from apps/api/.env so we test what the API will use.
    $appUrl = $null
    if (Test-Path -LiteralPath $envFile) {
        $match = Select-String -LiteralPath $envFile -Pattern '^DATABASE_URL=(.+)$' |
                 Select-Object -First 1
        if ($match) { $appUrl = $match.Matches[0].Groups[1].Value.Trim() }
    }

    if ($appUrl -and $appUrl -match '^postgresql://([^:]+):([^@]+)@([^:/]+):?(\d*)/(.+)$') {
        $appUser = $Matches[1]
        $env:PGPASSWORD = $Matches[2]
        $appHost = $Matches[3]
        $appPort = if ($Matches[4]) { [int] $Matches[4] } else { 5432 }
        $appDb = $Matches[5]

        $out = & $PsqlPath -h $appHost -p $appPort -U $appUser -d $appDb -w -t -A `
            -c 'select current_user || ''@'' || current_database();' 2>&1
        if ($LASTEXITCODE -eq 0) {
            Write-Ok "runtime role connects: $($out | Select-Object -First 1)"
        } else {
            Write-Bad "runtime role could NOT connect: $out"
        }

        # The safety property: the application must not be able to alter the schema.
        $null = & $PsqlPath -h $appHost -p $appPort -U $appUser -d $appDb -w `
            -c 'create table provisioning_must_fail (id int);' 2>&1
        if ($LASTEXITCODE -ne 0) {
            Write-Ok 'runtime role correctly DENIED schema changes (no DDL)'
        } else {
            Write-Bad 'runtime role was able to CREATE TABLE - the split-role model is NOT in effect'
            $null = & $PsqlPath -h $appHost -p $appPort -U $appUser -d $appDb -w `
                -c 'drop table provisioning_must_fail;' 2>&1
        }
    } else {
        Write-Host '    (skipped runtime checks: could not read DATABASE_URL from apps/api/.env)' -ForegroundColor Yellow
    }

    Write-Host "`nDone. Start the API with 'pnpm --filter @hexpayroll/api dev' and check /api/health." -ForegroundColor White
}
finally {
    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
}
