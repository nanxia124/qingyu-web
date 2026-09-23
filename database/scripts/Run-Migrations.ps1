param(
    [string]$Database = $(if ($env:PGDATABASE) { $env:PGDATABASE } else { 'qingyu_business' }),
    [string]$HostName = $(if ($env:PGHOST) { $env:PGHOST } else { 'localhost' }),
    [int]$Port = $(if ($env:PGPORT) { [int]$env:PGPORT } else { 5432 }),
    [string]$User = $(if ($env:PGUSER) { $env:PGUSER } else { 'user' }),
    [string]$MigrationDirectory = (Join-Path $PSScriptRoot '..\migrations')
)

$ErrorActionPreference = 'Stop'
$verify = Join-Path $PSScriptRoot 'Verify-MigrationManifest.ps1'
& $verify
if ($LASTEXITCODE -ne 0) { throw 'Migration manifest verification failed.' }

$psqlBase = @('-X', '-h', $HostName, '-p', $Port, '-U', $User, '-d', $Database)
$files = Get-ChildItem -LiteralPath $MigrationDirectory -Filter '*.sql' -File | Sort-Object Name
foreach ($file in $files) {
    $version = [IO.Path]::GetFileNameWithoutExtension($file.Name)
    $exists = $false
    if ($version -ne '0001_foundation') {
        $result = & psql @psqlBase -Atqc "SELECT EXISTS (SELECT 1 FROM app.schema_migrations WHERE version = '$version');"
        if ($LASTEXITCODE -ne 0) { throw "Cannot read migration state before $version." }
        $exists = ($result.Trim() -eq 't')
    }
    if ($exists) {
        Write-Output "SKIP $version"
        continue
    }
    Write-Output "APPLY $version"
    & psql @psqlBase -v ON_ERROR_STOP=1 -f $file.FullName
    if ($LASTEXITCODE -ne 0) { throw "Migration failed: $version" }
}
Write-Output 'All migrations are applied.'
