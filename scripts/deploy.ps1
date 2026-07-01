param(
    [string]$ConsumerDir
)

$ErrorActionPreference = "Stop"
$LibDir = $PSScriptRoot | Split-Path

Set-Location $LibDir

# ── 0. Resolve consumer path ───────────────────────────────────────────────────
# This is a public library — it must not hardcode a specific private app's path.
# Pass -ConsumerDir explicitly, or create scripts/deploy.local.json (gitignored)
# with { "consumerDir": "D:\\path\\to\\your\\app" } for local convenience.
if (-not $ConsumerDir) {
    $localConfigPath = Join-Path $PSScriptRoot "deploy.local.json"
    if (Test-Path $localConfigPath) {
        $ConsumerDir = (Get-Content $localConfigPath -Raw | ConvertFrom-Json).consumerDir
    }
}
if (-not $ConsumerDir) {
    throw "No consumer directory specified. Pass -ConsumerDir <path>, or create scripts/deploy.local.json with { ""consumerDir"": ""<path>"" }."
}

# ── 1. Read version from the library's package.json ───────────────────────────
$libPkg = Get-Content "projects\mermaid-runtime\package.json" -Raw | ConvertFrom-Json
$version = $libPkg.version
$pkgName = $libPkg.name                                # @daxur-studios/mermaid-runtime
$tgzName = ($pkgName -replace '^@', '' -replace '/', '-') + "-$version.tgz"
Write-Host "Library: $pkgName@$version  tgz: $tgzName"

# ── 2. Build + pack ───────────────────────────────────────────────────────────
Write-Host "`nBuilding..."
ng build mermaid-runtime
if ($LASTEXITCODE -ne 0) { throw "ng build failed" }

Write-Host "Packing..."
Push-Location "dist\mermaid-runtime"
npm pack --quiet
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "npm pack failed" }
Pop-Location

$tgzSrc = "dist\mermaid-runtime\$tgzName"
if (-not (Test-Path $tgzSrc)) { throw "Expected tgz not found: $tgzSrc" }

# ── 3. Copy to consumer ───────────────────────────────────────────────────────
$tgzDst = Join-Path $ConsumerDir $tgzName
Write-Host "`nCopying $tgzName → $ConsumerDir"
Copy-Item $tgzSrc $tgzDst -Force

# ── 4. Update package-lock.json integrity ─────────────────────────────────────
# npm locks file: tarballs by content-hash; when the tgz changes without a
# version bump the lockfile integrity must be updated or npm throws EINTEGRITY.
$lockPath = Join-Path $ConsumerDir "package-lock.json"
if (Test-Path $lockPath) {
    $sha512 = [System.Security.Cryptography.SHA512]::Create()
    $hash = $sha512.ComputeHash([System.IO.File]::ReadAllBytes($tgzDst))
    $newIntegrity = "sha512-" + [Convert]::ToBase64String($hash)

    $lock = Get-Content $lockPath -Raw
    # Capture the package block opening + integrity key, replace only the hash value.
    # Uses a capture group (not a lookbehind) so .NET's fixed-length lookbehind
    # restriction is not a problem.
    $escapedPkg = [regex]::Escape("node_modules/$pkgName")
    $pattern = '("' + $escapedPkg + '"[\s\S]{1,400}?"integrity":\s*")[^"]+'
    $updated = [regex]::Replace($lock, $pattern, ('$1' + $newIntegrity))
    if ($updated -eq $lock) {
        Write-Host "  (lockfile integrity line not found - skipping update)"
    } else {
        Set-Content $lockPath $updated -NoNewline
        Write-Host "  Lockfile integrity updated -> $($newIntegrity.Substring(0, 30))..."
    }
}

# ── 5. Reinstall ──────────────────────────────────────────────────────────────
Write-Host "`nInstalling in consumer..."
$nodeModulesDir = Join-Path $ConsumerDir "node_modules"
$installedPkg = Join-Path $nodeModulesDir ($pkgName -replace '/', '\')
if (Test-Path $installedPkg) {
    Remove-Item -Recurse -Force $installedPkg
}
Push-Location $ConsumerDir
npm install --no-audit --no-fund --prefer-offline 2>&1 | Select-Object -Last 5
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "npm install failed" }
Pop-Location
 
# ── 6. Verify ─────────────────────────────────────────────────────────────────
$pkgSubpath = Join-Path ($pkgName -replace '/', '\') "fesm2022"
$pkgFile = ($pkgName -replace '^@', '' -replace '/', '-') + ".mjs"
$mjs = Join-Path $nodeModulesDir (Join-Path $pkgSubpath $pkgFile)
if (-not (Test-Path $mjs)) {
    Write-Warning "Installed mjs not found at: $mjs"
} else {
    $hits = (Select-String -Path $mjs -Pattern "selector: 'mr-").Count
    if ($hits -gt 0) {
        Write-Host "`nDeploy complete. $hits mr-* selector(s) verified in installed package."
    } else {
        Write-Warning "mr-* selectors NOT found in installed package - check build output."
    }
}
