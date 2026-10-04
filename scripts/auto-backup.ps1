#Requires -Version 5.1
<#
    auto-backup.ps1
    -------------------------------------------------------------
    שומר גרסה בגיט באופן אוטומטי בכל שינוי בקובצי הפרוייקט.

    מתנהג כמו "שומר אוטומטי" של עורכים:
      1. מבצע commit ראשוני אם המאגר עדיין לא מאושלם.
      2. מרגע שהמשתמש מפסיק להקליד, ממתין זמן קצר (שקט),
         בודק אם השתנה משהו, ואם כן - עושה commit.
      3. לא יוצר commit מיותר אם אין שינויים.

    הפעלה:
        powershell -ExecutionPolicy Bypass -File .\scripts\auto-backup.ps1

    עצירה:
        לחיצה על Ctrl+C בחלון הזה.
#>

[CmdletBinding()]
param(
    # שניות שקט לפני ביצוע commit (ברירת מחדל: 10 שניות)
    [int]$DebounceSeconds = 10,

    # קבצים/תיקיות שלא לגבות (בנוסף ל-.gitignore)
    [string[]]$Exclude = @('node_modules', '*.log')
)

$ErrorActionPreference = 'Stop'

# --- אתר את שורש הפרוייקט -------------------------------------------------------
$project = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $project

Write-Host ""
Write-Host "  Auto-backup - Chess project" -ForegroundColor Cyan
Write-Host "  Folder : $project" -ForegroundColor DarkGray
Write-Host "  Idle   : $DebounceSeconds seconds" -ForegroundColor DarkGray
Write-Host "  Stop   : Ctrl+C" -ForegroundColor DarkGray
Write-Host ""

# --- בדיקות סביבה ---------------------------------------------------------------
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Host "Git was not found on this computer." -ForegroundColor Red
    exit 1
}

if (-not (Test-Path (Join-Path $project '.git'))) {
    Write-Host "No git repository found. Initializing one..." -ForegroundColor Yellow
    git init | Out-Null
}

# הגדרת זהות ברירת מחדל כדי שה-commit יעבוד גם במחשב חדש
try {
    $null = git config user.name 2>$null
    if (-not $?) {
        git config user.name "Chess Project Auto Backup" | Out-Null
        git config user.email "autobackup@localhost" | Out-Null
        Write-Host "Set a default git identity for this repository." -ForegroundColor Yellow
    }
} catch {
    git config user.name "Chess Project Auto Backup" | Out-Null
    git config user.email "autobackup@localhost" | Out-Null
}

# --- commit ראשוני ---------------------------------------------------------------
$status = git status --porcelain
if ($status) {
    Write-Host "Saving current state as the first version..." -ForegroundColor Cyan
    git add --all | Out-Null
    git commit -m "Initial auto-backup - $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" | Out-Null
    Write-Host "Created: $(git log -1 --oneline)" -ForegroundColor Green
    Write-Host ""
}

# --- פונקציות עזר ---------------------------------------------------------------

<#
    מחזיר true אם השתנה משהו מאז הבדיקה הקודמת.
    משתמש בטביעת אצבע של המצב כדי לא לספור שינויי רעש.
#>
function Test-RepoChanged {
    param([string]$PreviousFingerprint)

    $current = git status --porcelain
    if (-not $current) { return $null }

    $text = ($current -join "`n")
    $files = ($current | ForEach-Object { $_.Substring(3) }) -join '|'

    # Hash של שם הקבצים + גודלם, כדי לזהות שינוי תוכן ולא רק נוכחות
    $sizes = foreach ($line in $current) {
        $path = $line.Substring(3).Trim('"')
        $full = Join-Path $project $path
        if (Test-Path $full -PathType Leaf) {
            "$path=$((Get-Item $full).Length)"
        } else {
            "$path=dir"
        }
    }
    $fingerprint = "$files||$($sizes -join ',')"

    if ($fingerprint -eq $PreviousFingerprint) { return $null }
    return $fingerprint
}

<#
    מריץ פקודת git בלי ש-powershell יתיישם על הפלט של git.
    git כותב הודעות אזהרה ל-stderr (למשל המרת שורות EOL) ואלו אינן שגיאה,
    אך עם ErrorActionPreference = 'Stop' הן מפילות את הסקריפט.
#>
function Invoke-Git {
    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)

    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $output = & git @Arguments 2>&1
        return $output
    } finally {
        $ErrorActionPreference = $previous
    }
}

<#
    יוצר commit אם יש שינויים. מחזיר true אם נשמר.
#>
function Save-Change {
    param([string]$Reason = 'change')

    $status = Invoke-Git 'status' '--porcelain'
    if (-not $status) { return $false }

    $count = @($status).Count
    $time = Get-Date -Format 'HH:mm:ss'

    [void](Invoke-Git 'add' '--all')
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[$time] Could not stage files - skipped." -ForegroundColor Red
        return $false
    }

    $message = "Auto-backup ($Reason) - $time"
    [void](Invoke-Git 'commit' '-m' $message)
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[$time] Nothing new to save." -ForegroundColor DarkGray
        return $false
    }

    Write-Host "[$time] Saved $count file(s): $message" -ForegroundColor Green
    return $true
}

# --- לולאת המעקב ---------------------------------------------------------------

# $pendingSince  – מתי התחיל השקט הנוכחי (null = אין שינוי ממתין)
# $savedPrint   – טביעת האצבע שכבר הדפסנו למשתמש, כדי לא להציף הודעות כפולות
$pendingSince = $null
$announced = $null

Write-Host "Watching for changes. Leave this window open." -ForegroundColor Cyan
Write-Host ""

try {
    while ($true) {
        Start-Sleep -Seconds 2

        $current = @(Invoke-Git 'status' '--porcelain')

        # --- מצב נקי: אין מה לשמור -------------------------------------------
        if ($current.Count -eq 0) {
            if ($null -ne $pendingSince) {
                Write-Host "Nothing left to save - timer cleared." -ForegroundColor DarkGray
                $pendingSince = $null
                $announced = $null
            }
            continue
        }

        # --- טביעת אצבע של המצב הנוכחי ----------------------------------------
        $parts = foreach ($line in $current) {
            $path = $line.Substring(3).Trim('"')
            $full = Join-Path $project $path
            if (Test-Path $full -PathType Leaf) {
                "$path=$((Get-Item $full).Length)"
            } else {
                "$path=dir"
            }
        }
        $fingerprint = ($parts -join ',')

        # --- שינוי חדש? התחל ספירת זמן שקט מחדש -------------------------------
        if ($fingerprint -ne $announced) {
            if ($null -ne $pendingSince) {
                Write-Host "More changes - waiting $DebounceSeconds seconds again..." -ForegroundColor DarkGray
            } else {
                Write-Host "Change detected - saving in $DebounceSeconds seconds..." -ForegroundColor Yellow
            }
            $pendingSince = Get-Date
            $announced = $fingerprint
            continue
        }

        # --- המצב יציב: האם עבר די השקט? --------------------------------------
        $quiet = ((Get-Date) - $pendingSince).TotalSeconds
        if ($quiet -ge $DebounceSeconds) {
            if (Save-Change -Reason 'edit') {
                $pendingSince = $null
                $announced = $null
            } else {
                # נכשל - ננסה שוב בסבב הבא
                $pendingSince = Get-Date
            }
        } else {
            $left = [Math]::Ceiling($DebounceSeconds - $quiet)
            Write-Host "  ...$left second(s) left" -ForegroundColor DarkGray
        }
    }
} catch {
    Write-Host ""
    Write-Host "Auto-backup stopped." -ForegroundColor Yellow
    Write-Host ("Error: " + $_.Exception.Message) -ForegroundColor Red
    Write-Host ("Line " + $_.InvocationInfo.ScriptLineNumber + ": " + $_.InvocationInfo.Line.Trim()) -ForegroundColor DarkRed
    exit 1
}
