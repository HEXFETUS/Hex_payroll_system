$ErrorActionPreference = 'Stop'
$workspaceRoot = Split-Path $PSScriptRoot -Parent
$runtimeRoot = Join-Path $workspaceRoot 'deploy\central-api-linux'
if (-not (Test-Path -LiteralPath (Join-Path $runtimeRoot 'apps\api\package.json'))) { throw 'Existing production package structure is required.' }
if (-not (Test-Path -LiteralPath (Join-Path $workspaceRoot 'apps\api\dist\cli\central-bootstrap.js'))) { throw 'Build the central bootstrap command before packaging.' }
if (-not (Test-Path -LiteralPath (Join-Path $workspaceRoot 'apps\api\dist\cli\central-node.js'))) { throw 'Build the central node command before packaging.' }

# Keep the existing production manifests. Replace compiled output completely so
# obsolete CLIs and stale compilation products cannot survive a refresh.
foreach ($packagePath in @('apps\api', 'packages\shared', 'packages\payroll-engine')) {
    $source = Join-Path $workspaceRoot "$packagePath\dist"
    $target = [IO.Path]::GetFullPath((Join-Path $runtimeRoot "$packagePath\dist"))
    if (-not (Test-Path -LiteralPath $source)) { throw "Build output missing: $source. Run pnpm build first." }
    if (-not $target.StartsWith([IO.Path]::GetFullPath($runtimeRoot) + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe output path' }
}

foreach ($packagePath in @('apps\api', 'packages\shared', 'packages\payroll-engine')) {
    $source = Join-Path $workspaceRoot "$packagePath\dist"
    $target = Join-Path $runtimeRoot "$packagePath\dist"
    if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force }
    New-Item -ItemType Directory -Path $target -Force | Out-Null
    foreach ($file in Get-ChildItem -LiteralPath $source -File -Recurse) {
        $relative = $file.FullName.Substring($source.Length + 1)
        if ($packagePath -eq 'apps\api') {
            if ($relative.StartsWith('cli\') -and $relative -notin @('cli\central-bootstrap.js', 'cli\central-bootstrap.js.map', 'cli\central-node.js', 'cli\central-node.js.map')) { continue }
            if ($relative -in @('db\migrate.js', 'db\migrate.js.map')) { continue }
        }
        $destination = Join-Path $target $relative
        New-Item -ItemType Directory -Path (Split-Path $destination -Parent) -Force | Out-Null
        Copy-Item -LiteralPath $file.FullName -Destination $destination
    }
}
Copy-Item -LiteralPath (Join-Path $workspaceRoot 'docs\central-bootstrap.md') -Destination (Join-Path $runtimeRoot 'central-bootstrap.md') -Force
Copy-Item -LiteralPath (Join-Path $workspaceRoot 'docs\central-enrollment.md') -Destination (Join-Path $runtimeRoot 'central-enrollment.md') -Force
Write-Output 'Central compiled runtime refreshed. Only central-bootstrap and central-node are shipped as CLIs. Archive and checksum untouched.'
