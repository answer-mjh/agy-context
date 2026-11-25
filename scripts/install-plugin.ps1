param(
  [string]$SourceDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
  [string]$TargetDir = (Join-Path $env:USERPROFILE ".gemini\config\plugins\agy-context")
)

$ErrorActionPreference = "Stop"

Write-Host "Installing agy-context plugin..." -ForegroundColor Cyan
Write-Host "  Source: $SourceDir"
Write-Host "  Target: $TargetDir"

if (-not (Test-Path (Join-Path $SourceDir "plugin.json"))) {
  throw "plugin.json not found in $SourceDir"
}

$parent = Split-Path -Parent $TargetDir
if (-not (Test-Path $parent)) {
  New-Item -ItemType Directory -Force -Path $parent | Out-Null
}

$oldStaging = "$TargetDir.staging"
if (Test-Path $oldStaging) {
  Remove-Item -Recurse -Force $oldStaging -ErrorAction SilentlyContinue
}

if (-not (Test-Path $TargetDir)) {
  New-Item -ItemType Directory -Force -Path $TargetDir | Out-Null
}

$includeItems = @("plugin.json", "README.md", "README.en.md", "LICENSE", "NOTICE", "assets", "docs", "skills", "sidecars")
foreach ($item in $includeItems) {
  $src = Join-Path $SourceDir $item
  $dst = Join-Path $TargetDir $item
  if (Test-Path $src) {
    if (Test-Path $src -PathType Container) {
      if (-not (Test-Path $dst)) { New-Item -ItemType Directory -Force -Path $dst | Out-Null }
      Copy-Item -Recurse -Force -Path (Join-Path $src "*") -Destination $dst
    } else {
      Copy-Item -Force -Path $src -Destination $dst
    }
  }
}

Write-Host "Installed successfully to $TargetDir" -ForegroundColor Green
Write-Host "Next: Open Customizations -> agy-context in Antigravity App to enable the plugin and sidecar."
