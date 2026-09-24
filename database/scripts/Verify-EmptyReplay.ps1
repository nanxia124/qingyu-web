param(
    [string]$MigrationDirectory = (Join-Path $PSScriptRoot '..\migrations'),
    [string]$Image = 'postgres:16',
    [string]$ContainerName = "qingyu-empty-replay-$PID"
)

$ErrorActionPreference = 'Stop'
$migrationPath = (Resolve-Path -LiteralPath $MigrationDirectory).Path
$files = Get-ChildItem -LiteralPath $migrationPath -Filter '*.sql' -File | Sort-Object Name
if ($files.Count -eq 0) { throw "没有找到迁移文件：$migrationPath" }
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw '未找到 Docker，无法执行空库重放。' }

$container = $null
try {
    & docker rm -f $ContainerName 2>$null | Out-Null
    $volume = "${migrationPath}:/migrations:ro"
    $container = (& docker run -d --name $ContainerName -e POSTGRES_PASSWORD=verify -v $volume $Image).Trim()
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($container)) { throw '临时 PostgreSQL 容器启动失败。' }

    $ready = $false
    for ($i = 0; $i -lt 30; $i++) {
        & docker exec $ContainerName pg_isready -U postgres -d postgres 2>$null | Out-Null
        if ($LASTEXITCODE -eq 0) { $ready = $true; break }
        Start-Sleep -Seconds 1
    }
    if (-not $ready) { throw '临时 PostgreSQL 在 30 秒内没有就绪。' }

    & docker exec $ContainerName psql -U postgres -d postgres -v ON_ERROR_STOP=1 -c 'create role qingyu_app; create role qingyu_api;' | Out-Null
    foreach ($file in $files) {
        Write-Output ("APPLY {0}" -f $file.BaseName)
        & docker exec $ContainerName psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f ("/migrations/{0}" -f $file.Name) | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "空库重放失败：$($file.Name)" }
    }

    $result = & docker exec $ContainerName psql -U postgres -d postgres -Atqc @'
select 'schema_migrations=' || count(*) from app.schema_migrations;
select 'tables=' || count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='app' and c.relkind='r';
select 'rls_tables=' || count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='app' and c.relkind='r' and c.relrowsecurity;
'@
    $result
    if ($LASTEXITCODE -ne 0) { throw '空库重放后的结构统计失败。' }
    Write-Output 'PASS: 空库迁移重放完成。'
}
finally {
    if ($container) { & docker rm -f $ContainerName 2>$null | Out-Null }
}
