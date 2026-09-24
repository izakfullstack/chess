$ErrorActionPreference = "Stop"

$project = "C:\Users\user1\Documents\תיק עבודות\תכנות\פרוייקטים חדשים\chess"
Set-Location $project

$status = git status --porcelain
if (-not $status) {
    Write-Host "אין שינויים שדורשים גיבוי."
    exit 0
}

$message = "Backup before change - $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
git add --all
git commit -m $message

Write-Host "נוצר גיבוי מקומי: $message"
git log -1 --oneline
