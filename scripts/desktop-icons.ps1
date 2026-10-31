param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('hide', 'show', 'status')]
    [string]$Action,
    [string]$ResultPath = ''
)

$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;

public static class FuguangDesktopIcons
{
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern bool EnumChildWindows(IntPtr hWndParent, EnumWindowsProc lpEnumFunc, IntPtr lParam);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam, uint fuFlags, uint uTimeout, out IntPtr lpdwResult);
}
'@

function Get-WindowClass {
    param([IntPtr]$Handle)
    $sb = New-Object System.Text.StringBuilder 128
    [void][FuguangDesktopIcons]::GetClassName($Handle, $sb, 128)
    return $sb.ToString()
}

function Get-Progman {
    $script:found = [IntPtr]::Zero
    $callback = [FuguangDesktopIcons+EnumWindowsProc]{
        param([IntPtr]$h, [IntPtr]$l)
        if ((Get-WindowClass $h) -eq 'Progman') {
            $script:found = $h
            return $false
        }
        return $true
    }
    [void][FuguangDesktopIcons]::EnumWindows($callback, [IntPtr]::Zero)
    return $script:found
}

function Get-DefView {
    $progman = Get-Progman
    if ($progman -ne [IntPtr]::Zero) {
        $script:foundChild = [IntPtr]::Zero
        $cb = [FuguangDesktopIcons+EnumWindowsProc]{
            param([IntPtr]$h, [IntPtr]$l)
            if ((Get-WindowClass $h) -eq 'SHELLDLL_DefView') {
                $script:foundChild = $h
                return $false
            }
            return $true
        }
        [void][FuguangDesktopIcons]::EnumChildWindows($progman, $cb, [IntPtr]::Zero)
        if ($script:foundChild -ne [IntPtr]::Zero) { return $script:foundChild }
    }

    # Fallback: desktops with wallpaper slideshow / certain shells can host
    # SHELLDLL_DefView under a WorkerW window instead of Progman.
    $script:workerView = [IntPtr]::Zero
    $topCb = [FuguangDesktopIcons+EnumWindowsProc]{
        param([IntPtr]$h, [IntPtr]$l)
        if ((Get-WindowClass $h) -eq 'WorkerW') {
            $script:inner = [IntPtr]::Zero
            $innerCb = [FuguangDesktopIcons+EnumWindowsProc]{
                param([IntPtr]$ch, [IntPtr]$cl)
                if ((Get-WindowClass $ch) -eq 'SHELLDLL_DefView') {
                    $script:inner = $ch
                    return $false
                }
                return $true
            }
            [void][FuguangDesktopIcons]::EnumChildWindows($h, $innerCb, [IntPtr]::Zero)
            if ($script:inner -ne [IntPtr]::Zero) {
                $script:workerView = $script:inner
                return $false
            }
        }
        return $true
    }
    [void][FuguangDesktopIcons]::EnumWindows($topCb, [IntPtr]::Zero)
    return $script:workerView
}

function Get-HideIcons {
    $key = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced'
    $value = (Get-ItemProperty -Path $key -Name HideIcons -ErrorAction SilentlyContinue).HideIcons
    if ($null -eq $value) { return 0 }
    return [int]$value
}

$before = Get-HideIcons
$target = if ($Action -eq 'hide') { 1 } elseif ($Action -eq 'show') { 0 } else { $before }
$toggled = $false
$attempts = 0
$errorText = ''

if ($Action -ne 'status' -and $before -ne $target) {
    for ($i = 0; $i -lt 4; $i++) {
        $attempts++
        $view = Get-DefView
        if ($view -eq [IntPtr]::Zero) {
            $errorText = 'SHELLDLL_DefView not found'
            Start-Sleep -Milliseconds 250
            continue
        }
        $out = [IntPtr]::Zero
        [void][FuguangDesktopIcons]::SendMessageTimeout(
            $view, 0x111, [IntPtr]0x7402, [IntPtr]::Zero, 0x0002, 1500, [ref]$out)
        Start-Sleep -Milliseconds 280
        if ((Get-HideIcons) -eq $target) {
            $toggled = $true
            $errorText = ''
            break
        }
    }
}

$after = Get-HideIcons
$ok = ($after -eq $target)
if (-not $ok -and $errorText -eq '') {
    $errorText = "Desktop icon state is $after, expected $target"
}

$result = [ordered]@{
    ok       = $ok
    action   = $Action
    before   = $before
    after    = $after
    target   = $target
    toggled  = $toggled
    attempts = $attempts
    error    = $errorText
} | ConvertTo-Json -Compress

if ($ResultPath -ne '') {
    [System.IO.File]::WriteAllText($ResultPath, $result, (New-Object System.Text.UTF8Encoding($false)))
} else {
    Write-Output $result
}

if ($ok) { exit 0 } else { exit 3 }
