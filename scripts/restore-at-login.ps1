param()

$ErrorActionPreference = 'SilentlyContinue'
$logDir = Join-Path $env:APPDATA 'FuguangDrawer'
$logPath = Join-Path $logDir 'guard.log'
try { $null = New-Item -ItemType Directory -Force -Path $logDir } catch { }

function Write-GuardLog([string]$message) {
    try {
        Add-Content -LiteralPath $logPath -Value ("[{0}] {1}" -f (Get-Date -Format o), $message) -Encoding UTF8
    } catch { }
}

try {
    $desktopScript = Join-Path $PSScriptRoot 'desktop-icons.ps1'
    if (-not (Test-Path -LiteralPath $desktopScript)) {
        Write-GuardLog "desktop-icons.ps1 not found"
        exit 2
    }
    $result = & $desktopScript -Action show 2>&1
    Write-GuardLog ("runonce restore: " + ($result -join ' '))
} catch {
    Write-GuardLog ("runonce restore failed: " + $_.Exception.Message)
}
exit 0
