param(
    [string]$MigrationDirectory = (Join-Path $PSScriptRoot '..\migrations'),
    [string]$TestDirectory = (Join-Path $PSScriptRoot '..\tests'),
    [string]$Image = 'postgres:16',
    [string]$ContainerName = "qingyu-database-tests-$PID"
)

$ErrorActionPreference = 'Stop'
$migrationPath = (Resolve-Path -LiteralPath $MigrationDirectory).Path
$testPath = (Resolve-Path -LiteralPath $TestDirectory).Path
$migrations = Get-ChildItem -LiteralPath $migrationPath -Filter '*.sql' -File | Sort-Object Name
$tests = Get-ChildItem -LiteralPath $testPath -Filter '*.sql' -File | Sort-Object Name
if (-not $migrations.Count) { throw "没有找到迁移文件：$migrationPath" }
if (-not $tests.Count) { throw "没有找到数据库测试：$testPath" }
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw '未找到 Docker，无法执行数据库测试。' }
& (Join-Path $PSScriptRoot 'Verify-MigrationManifest.ps1') -MigrationDirectory $migrationPath -ManifestPath (Join-Path $migrationPath 'MANIFEST.sha256.json')

$container = $null
try {
    $migrationVolume = "${migrationPath}:/migrations:ro"
    $testVolume = "${testPath}:/tests:ro"
    $created = & docker run -d --name $ContainerName -e POSTGRES_PASSWORD=verify -v $migrationVolume -v $testVolume $Image
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($created)) { throw '临时 PostgreSQL 容器启动失败；不会删除已有同名容器。' }
    $container = $created.Trim()

    $ready = $false
    for ($i = 0; $i -lt 30; $i++) {
        & docker exec $ContainerName pg_isready -U postgres -d postgres 2>$null | Out-Null
        if ($LASTEXITCODE -eq 0) { $ready = $true; break }
        Start-Sleep -Seconds 1
    }
    if (-not $ready) { throw '临时 PostgreSQL 在 30 秒内没有就绪。' }

    & docker exec $ContainerName psql -U postgres -d postgres -v ON_ERROR_STOP=1 -c 'create role qingyu_app; create role qingyu_api;' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw '测试角色初始化失败。' }
    foreach ($file in $migrations) {
        & docker exec $ContainerName psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f ("/migrations/{0}" -f $file.Name) | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "迁移失败：$($file.Name)" }
    }

    $passed = 0
    foreach ($file in $tests) {
        Write-Output ("TEST {0}" -f $file.BaseName)
        & docker exec $ContainerName psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f ("/tests/{0}" -f $file.Name)
        if ($LASTEXITCODE -ne 0) { throw "数据库测试失败：$($file.Name)" }
        $passed++
    }
    Write-Output ("PASS: {0} 个数据库测试全部通过；测试容器即将清理。" -f $passed)
}
finally {
    if ($container) {
        & docker rm -f $container | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "测试容器清理失败，请检查容器编号：$container" }
    }
}
