param(
    [Parameter(Mandatory = $true)][string]$InputPath,
    [Parameter(Mandatory = $true)][string]$OutputPath,
    [Parameter(Mandatory = $true)][string]$DllPath,
    [int]$Size = 96
)

$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding($false)

try {
    Add-Type -Path $DllPath -ReferencedAssemblies System.Drawing
} catch {
    [System.IO.File]::WriteAllText($OutputPath, '{"ok":false,"error":"load failed"}', $utf8)
    exit 2
}

$paths = @()
try {
    $paths = @([System.IO.File]::ReadAllLines($InputPath, [System.Text.Encoding]::UTF8))
} catch {
    [System.IO.File]::WriteAllText($OutputPath, '{"ok":false,"error":"invalid input"}', $utf8)
    exit 3
}

$results = New-Object System.Collections.Generic.List[object]
foreach ($path in $paths) {
    if ([string]::IsNullOrWhiteSpace($path)) { continue }
    $data = $null
    try {
        $data = [FuguangIconExtractor]::GetBase64([string]$path, $Size)
    } catch {
        $data = $null
    }
    $results.Add([ordered]@{ path = [string]$path; data = $data })
}

$payload = [ordered]@{
    ok    = $true
    size  = $Size
    count = $results.Count
    icons = $results
}

$json = ConvertTo-Json -InputObject $payload -Depth 5 -Compress
[System.IO.File]::WriteAllText($OutputPath, $json, $utf8)
exit 0
