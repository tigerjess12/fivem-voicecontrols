# Builds the Lite (Python required) and Full (bundled speech engine) .streamDeckPlugin files into ./release.
# Usage: powershell -ExecutionPolicy Bypass -File scripts/build-release.ps1 [-Version 0.1.0.0] [-SkipFull]
param(
    [string]$Version = "",
    [switch]$SkipFull
)

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

$name = "nz.tigerjess12.fivem-voicecontrols"
$plugin = "$name.sdPlugin"
$out = Join-Path $root "release"
$stage = Join-Path ([IO.Path]::GetTempPath()) "fvc-stage"

function Invoke-Step([string]$what, [scriptblock]$block) {
    & $block
    if ($LASTEXITCODE -ne 0) { throw "$what failed (exit code $LASTEXITCODE)" }
}

# Packs a copy of the plugin folder so the real one is never modified
function Pack-Variant([string]$variant, [string]$bundleDir) {
    $dir = Join-Path $stage $variant
    $pluginDir = Join-Path $dir $plugin
    Remove-Item $dir -Recurse -Force -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Force $dir | Out-Null
    Copy-Item $plugin $pluginDir -Recurse
    Copy-Item (Join-Path $root "THIRD_PARTY_NOTICES.md") $pluginDir
    if ($bundleDir) { Copy-Item $bundleDir (Join-Path $pluginDir "bin\listener") -Recurse }

    $packArgs = @("pack", $pluginDir, "-o", $dir, "--force", "--no-update-check", "--no-file-list")
    if ($Version) { $packArgs += @("--version", $Version) }
    Invoke-Step "streamdeck pack ($variant)" { npx streamdeck @packArgs }

    $packed = Join-Path $dir "$name.streamDeckPlugin"
    $target = Join-Path $out "fivem-voicecontrols-$variant.streamDeckPlugin"
    Move-Item $packed $target -Force
    "{0}: {1:N1} MB" -f $target, ((Get-Item $target).Length / 1MB)
}

Remove-Item $out -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $out | Out-Null

Invoke-Step "npm run build" { npm run build }

Pack-Variant "lite" $null

if (-not $SkipFull) {
    Invoke-Step "PyInstaller" { python -m PyInstaller app.spec --noconfirm }
    $exe = Join-Path $root "dist\listener\listener.exe"
    if (-not (Test-Path $exe)) {
        throw "dist\listener\listener.exe is missing. Antivirus often removes unsigned PyInstaller output; exclude the dist folder and retry."
    }
    Pack-Variant "full" (Join-Path $root "dist\listener")

    # Standalone copy so listener.exe can be restored if antivirus removes it from the installed plugin
    $zip = Join-Path $out "listener-windows.zip"
    Compress-Archive -Path (Join-Path $root "dist\listener\*") -DestinationPath $zip -Force
    "{0}: {1:N1} MB" -f $zip, ((Get-Item $zip).Length / 1MB)
}

Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
