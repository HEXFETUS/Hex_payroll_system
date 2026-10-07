$ErrorActionPreference = 'Stop'
$workspaceRoot = Split-Path $PSScriptRoot -Parent
$runtimeRoot = Join-Path $workspaceRoot 'deploy\central-api-linux'
$archive = Join-Path $workspaceRoot 'deploy\central-api-linux.tar.gz'
$temporaryArchive = "$archive.new"

# Refuse to archive unexpected files, including credentials, source and modules.
$allowedMetadata = @(
    'README.md', 'central-bootstrap.md', 'central-enrollment.md',
    'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml',
    'apps/api/package.json', 'apps/api/.env.example',
    'packages/shared/package.json', 'packages/payroll-engine/package.json'
)
foreach ($directory in Get-ChildItem -LiteralPath $runtimeRoot -Directory -Recurse -Force) {
    if ($directory.Name -in @('node_modules', 'src', 'test', 'tests', 'desktop', 'web')) { throw "Forbidden deployment directory: $($directory.Name)" }
    if ($directory.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Deployment links are not allowed' }
}
foreach ($file in Get-ChildItem -LiteralPath $runtimeRoot -File -Recurse -Force) {
    $relative = $file.FullName.Substring($runtimeRoot.Length + 1).Replace('\', '/')
    $compiled = $relative -match '^(apps/api|packages/shared|packages/payroll-engine)/dist/.+\.(js|js\.map|d\.ts|d\.ts\.map)$'
    if ($relative -notin $allowedMetadata -and -not $compiled) { throw "Unexpected deployment file: $relative" }
    if ($relative -match '/node_modules/|/src/|/test/') { throw "Forbidden deployment file: $relative" }
    if ($relative -match '^apps/api/dist/cli/' -and $relative -notmatch '^apps/api/dist/cli/(central-bootstrap|central-node)\.js(\.map)?$') { throw "Unapproved CLI: $relative" }
    if ($relative -match '^apps/api/dist/db/migrate\.js') { throw 'Migration tooling must not be shipped' }
}
foreach ($required in @('apps/api/dist/server.js', 'apps/api/dist/cli/central-bootstrap.js', 'apps/api/dist/cli/central-node.js')) {
    if (-not (Test-Path -LiteralPath (Join-Path $runtimeRoot $required))) { throw "Missing runtime file: $required" }
}
tar -czf $temporaryArchive -C (Join-Path $workspaceRoot 'deploy') central-api-linux
if ($LASTEXITCODE -ne 0) { throw 'Archive creation failed' }
tar -tzf $temporaryArchive | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Archive integrity check failed' }
Move-Item -LiteralPath $temporaryArchive -Destination $archive -Force
$artifactHash = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLower()
"$artifactHash  central-api-linux.tar.gz" | Set-Content -LiteralPath "$archive.sha256" -NoNewline -Encoding ascii
Get-Item -LiteralPath $archive | Select-Object Name, Length
Get-Content -LiteralPath "$archive.sha256"
