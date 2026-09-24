param(
    [string]$Database = $(if ($env:PGDATABASE) { $env:PGDATABASE } else { 'qingyu_business' }),
    [string]$HostName = $(if ($env:PGHOST) { $env:PGHOST } else { 'localhost' }),
    [int]$Port = $(if ($env:PGPORT) { [int]$env:PGPORT } else { 5432 }),
    [string]$User = $(if ($env:PGUSER) { $env:PGUSER } else { 'user' }),
    [string]$MigrationDirectory = (Join-Path $PSScriptRoot '..\migrations')
)

$ErrorActionPreference = 'Stop'
$verify = Join-Path $PSScriptRoot 'Verify-MigrationManifest.ps1'
& $verify -MigrationDirectory $MigrationDirectory -ManifestPath (Join-Path $MigrationDirectory 'MANIFEST.sha256.json')

$psqlBase = @('-X', '-h', $HostName, '-p', $Port, '-U', $User, '-d', $Database)
$files = Get-ChildItem -LiteralPath $MigrationDirectory -Filter '*.sql' -File | Sort-Object Name
# 空库还没有版本表；已初始化的库连第一版也必须检查，避免重建已有表。
$state = & psql @psqlBase -Atqc "SELECT to_regclass('app.schema_migrations') IS NOT NULL;"
if ($LASTEXITCODE -ne 0) { throw '无法读取数据库初始化状态。' }
$hasVersionTable = (($state -join '').Trim() -eq 't')
foreach ($file in $files) {
    $version = [IO.Path]::GetFileNameWithoutExtension($file.Name)
    if ($version -notmatch '^\d{4}_[a-z0-9_]+$') { throw "迁移文件名不符合规范：$version" }
    $exists = $false
    if ($hasVersionTable) {
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
    $hasVersionTable = $true
}
Write-Output 'All migrations are applied.'
