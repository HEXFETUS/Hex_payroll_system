# Run from any directory. The existing PostgreSQL password is never displayed.
$ErrorActionPreference = 'Stop'
$apiDirectory = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../apps/api'))
$securePassword = Read-Host 'Existing hexpayroll_migrator password' -AsSecureString
$passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
try {
    $env:HEXPAYROLL_MIGRATION_PASSWORD_INPUT = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
    Push-Location -LiteralPath $apiDirectory
    try {
        @'
import fs from 'node:fs';
import dotenv from 'dotenv';
import pg from 'pg';
try {
  const text = fs.readFileSync('.env', 'utf8');
  const url = new URL(dotenv.parse(text).MIGRATION_DATABASE_URL);
  url.password = encodeURIComponent(process.env.HEXPAYROLL_MIGRATION_PASSWORD_INPUT);
  const pool = new pg.Pool({connectionString:url.href, connectionTimeoutMillis:5000});
  try {
    const result = await pool.query("SELECT current_database() AS database, has_schema_privilege(current_user, 'public', 'CREATE') AS can_create");
    if (result.rows[0].database !== 'payroll_sys' || !result.rows[0].can_create) {
      throw new Error('preflight');
    }
  } finally { await pool.end(); }
  const matches = [...text.matchAll(/^MIGRATION_DATABASE_URL\s*=.*$/gm)];
  if (matches.length !== 1) throw new Error('configuration');
  fs.writeFileSync('.env', text.replace(/^MIGRATION_DATABASE_URL\s*=.*$/m, () => `MIGRATION_DATABASE_URL=${url.href}`));
  console.log('Migration password updated. Login and CREATE permission on payroll_sys verified.');
} catch {
  console.error('Password update failed. Check the existing password, database target, and migrator CREATE permission. No credentials were displayed.');
  process.exitCode = 1;
}
'@ | node --input-type=module
        if ($LASTEXITCODE -ne 0) { throw 'Migration password was not updated.' }
    } finally { Pop-Location }
} finally {
    Remove-Item Env:HEXPAYROLL_MIGRATION_PASSWORD_INPUT -ErrorAction SilentlyContinue
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
    $securePassword.Dispose()
}
