$ErrorActionPreference = "Stop"

$project = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $project

$status = git status --porcelain
if (-not $status) {
    Write-Host "No changes require a backup."
    exit 0
}

$message = "Backup before change - $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
git add --all
git commit -m $message

Write-Host "Created local backup: $message"
git log -1 --oneline
