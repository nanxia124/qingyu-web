param(
    [string]$MigrationDirectory = (Join-Path $PSScriptRoot '..\migrations'),
    [string]$ManifestPath = (Join-Path $PSScriptRoot '..\migrations\MANIFEST.sha256.json')
)

$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $ManifestPath)) { throw "Migration manifest not found: $ManifestPath" }
$manifest = Get-Content -LiteralPath $ManifestPath -Raw | ConvertFrom-Json
$files = Get-ChildItem -LiteralPath $MigrationDirectory -Filter '*.sql' -File | Sort-Object Name
$actual = @{}
foreach ($file in $files) {
    $content = [IO.File]::ReadAllText($file.FullName).Replace("`r`n", "`n")
    $bytes = [Text.UTF8Encoding]::new($false).GetBytes($content)
    $sha256 = [Security.Cryptography.SHA256]::Create()
    try { $actual[$file.Name] = [Convert]::ToHexString($sha256.ComputeHash($bytes)).ToLowerInvariant() }
    finally { $sha256.Dispose() }
}
$expectedNames = @($manifest.PSObject.Properties.Name | Sort-Object)
$actualNames = @($actual.Keys | Sort-Object)
if ((Compare-Object $expectedNames $actualNames)) { throw 'Migration files and manifest do not match.' }
foreach ($name in $expectedNames) {
    if ($actual[$name] -ne $manifest.$name.ToLowerInvariant()) {
        throw "Migration SHA-256 check failed: $name"
    }
}
Write-Output ("Migration manifest verified: {0} SQL files." -f $files.Count)
