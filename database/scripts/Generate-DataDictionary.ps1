param(
    [string]$InputCsv,
    [string]$OutputPath = (Join-Path $PSScriptRoot '..\..\docs\04-需求规范\12-数据库字段字典.md'),
    [string]$MigrationDirectory = (Join-Path $PSScriptRoot '..\migrations'),
    [string]$Image = 'postgres:16',
    [string]$ContainerName = ("qingyu-dictionary-{0}-{1}" -f $PID, [guid]::NewGuid().ToString('N').Substring(0, 8))
)

$ErrorActionPreference = 'Stop'

$domain = @{
    'user_'='用户与安全'; 'team'='团队与组织'; 'department'='团队与组织'; 'job_title'='团队与组织';
    'role'='权限'; 'permission'='权限'; 'access_'='权限'; 'subscription'='订阅与计费'; 'plan'='订阅与计费';
    'order'='订阅与计费'; 'payment'='订阅与计费'; 'refund'='订阅与计费'; 'invoice'='订阅与计费';
    'quota'='额度与用量'; 'usage'='额度与用量'; 'daily_'='额度与用量'; 'generation'='生成任务与结果';
    'asset'='资产与互动'; 'collection'='资产与互动'; 'file_'='文件对象'; 'canvas'='画布'; 'agent'='Agent';
    'ai_'='模型与渠道'; 'provider'='模型与渠道'; 'model_'='模型与渠道'; 'platform_'='平台运维';
    'admin_'='平台运维'; 'backup'='备份与恢复'; 'restore'='备份与恢复'; 'audit'='审计与安全';
    'security'='审计与安全'; 'notification'='通知'; 'outbox'='同步事件'; 'sync_'='同步事件';
    'prompt'='提示词'; 'plugin'='插件'; 'feedback'='反馈'; 'moderation'='内容安全'; 'consent'='隐私同意';
    'system_'='平台运维'; 'schema_'='平台运维'; 'resource_'='生命周期'; 'membership'='团队与组织';
    'workspace'='空间与多租户'; 'v_'='派生视图'
}

$common = @{
    'id'='主键编号'; 'workspace_id'='所属工作空间；多租户隔离的核心字段'; 'user_id'='关联用户内部编号';
    'created_at'='创建时间（UTC）'; 'updated_at'='最后更新时间（UTC）'; 'deleted_at'='软删除时间；为空表示未删除';
    'status'='生命周期状态；由表级约束限定枚举'; 'version'='乐观锁或配置版本号'; 'team_id'='所属团队编号';
    'email'='邮箱或联系地址'; 'metadata'='扩展元数据 JSON；不能存权限事实或密钥';
    'idempotency_key'='幂等编号；重复请求必须复用同一结果'
}

function Get-Domain([string]$tableName) {
    foreach ($key in $domain.Keys) {
        if ($tableName.StartsWith($key, [StringComparison]::OrdinalIgnoreCase)) { return $domain[$key] }
    }
    return '其他业务表'
}

function Escape-Markdown([string]$value) {
    return (($value -replace '\|', '\|') -replace '[\r\n]+', ' ').Trim()
}

function Format-Code([string]$value) {
    $safeValue = (Escape-Markdown $value) -replace '`', '\`'
    return '`' + $safeValue + '`'
}

function Get-SchemaRows {
    if (-not [string]::IsNullOrWhiteSpace($InputCsv)) {
        if (-not (Test-Path -LiteralPath $InputCsv -PathType Leaf)) { throw "字段清单文件不存在：$InputCsv" }
        $csvRows = @(Import-Csv -LiteralPath $InputCsv)
        if ($csvRows.Count -eq 0) { throw "字段清单文件没有数据：$InputCsv" }
        $requiredColumns = @('table_name', 'column_name', 'data_type', 'udt_name', 'is_nullable', 'coalesce')
        $availableColumns = @($csvRows[0].PSObject.Properties.Name)
        $missingColumns = @($requiredColumns | Where-Object { $_ -notin $availableColumns })
        if ($missingColumns.Count -gt 0) { throw ('字段清单缺少必需列：{0}' -f ($missingColumns -join ', ')) }
        return $csvRows
    }

    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw '未找到 Docker；可用 -InputCsv 指定已有的字段清单。' }
    $migrationPath = (Resolve-Path -LiteralPath $MigrationDirectory).Path
    $migrationFiles = @(Get-ChildItem -LiteralPath $migrationPath -Filter '*.sql' -File | Sort-Object Name)
    if ($migrationFiles.Count -eq 0) { throw "没有找到数据库更新文件：$migrationPath" }

    $manifestVerifier = Join-Path $PSScriptRoot 'Verify-MigrationManifest.ps1'
    & $manifestVerifier -MigrationDirectory $migrationPath -ManifestPath (Join-Path $migrationPath 'MANIFEST.sha256.json') | Out-Null

    $containerCreated = $false
    try {
        $migrationVolume = '{0}:/migrations:ro' -f $migrationPath
        $containerId = & docker run -d --name $ContainerName -e POSTGRES_PASSWORD=dictionary -v $migrationVolume $Image
        if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace(($containerId -join ''))) {
            throw '临时 PostgreSQL 容器启动失败；不会删除已有同名容器。'
        }
        $containerCreated = $true

        $ready = $false
        for ($attempt = 0; $attempt -lt 30; $attempt++) {
            & docker exec $ContainerName pg_isready -U postgres -d postgres 2>$null | Out-Null
            if ($LASTEXITCODE -eq 0) { $ready = $true; break }
            Start-Sleep -Seconds 1
        }
        if (-not $ready) { throw '临时 PostgreSQL 在 30 秒内没有就绪。' }

        $savedErrorActionPreference = $ErrorActionPreference
        try {
            $ErrorActionPreference = 'Continue'
            & docker exec $ContainerName psql -U postgres -d postgres -v ON_ERROR_STOP=1 -c 'create role qingyu_app; create role qingyu_api;' 2>&1 | Out-Null
            $roleExitCode = $LASTEXITCODE
            if ($roleExitCode -ne 0) { throw '临时数据库测试角色创建失败。' }

            foreach ($file in $migrationFiles) {
                & docker exec $ContainerName psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f ("/migrations/{0}" -f $file.Name) 2>&1 | Out-Null
                $migrationExitCode = $LASTEXITCODE
                if ($migrationExitCode -ne 0) { throw "临时数据库重建失败：$($file.Name)" }
            }
        }
        finally { $ErrorActionPreference = $savedErrorActionPreference }

        $query = @'
select table_name, column_name, data_type, udt_name, is_nullable,
       coalesce(column_default, '') as coalesce, ordinal_position
from information_schema.columns
where table_schema = 'app'
order by table_name, ordinal_position;
'@
        $csvOutput = & docker exec $ContainerName psql -U postgres -d postgres --csv -c $query
        if ($LASTEXITCODE -ne 0) { throw '读取临时数据库字段清单失败。' }
        $schemaRows = @($csvOutput | ConvertFrom-Csv | Where-Object {
            -not [string]::IsNullOrWhiteSpace($_.table_name) -and
            -not [string]::IsNullOrWhiteSpace($_.column_name)
        })
        if ($schemaRows.Count -eq 0) { throw '临时数据库没有 app schema 字段，拒绝生成空字典。' }
        return $schemaRows
    }
    finally {
        if ($containerCreated) {
            & docker rm -f $ContainerName | Out-Null
            if ($LASTEXITCODE -ne 0) { throw "临时数据库清理失败，请检查容器：$ContainerName" }
        }
    }
}

$rows = @(Get-SchemaRows)
$tableCount = @($rows | Group-Object table_name).Count

$out = [System.Collections.Generic.List[string]]::new()
$out.Add('## 数据分层'); $out.Add('')
$out.Add('- **用户与安全**：账号、设备、会话、同意和安全事件。')
$out.Add('- **空间与多租户**：个人空间、团队空间和组织成员关系。所有业务数据必须沿 `workspace_id` 或专用授权关系隔离。')
$out.Add('- **订阅与计费**：套餐、订单、支付、订阅、退款、发票。支付事实不能用前端状态代替。')
$out.Add('- **额度与用量**：预占、结算、释放、流水和对账。余额是可重算结果，流水才是事实。')
$out.Add('- **内容与生成**：生成任务、结果、资产、文件、收藏、点赞和评论。')
$out.Add('- **平台运维**：模型目录、渠道、备份、恢复、管理员和系统设置。'); $out.Add('')
$out.Add('## 字段约定'); $out.Add(''); $out.Add('| 列 | 含义 |'); $out.Add('|---|---|')
$out.Add('| 表 | PostgreSQL 表或视图名 |'); $out.Add('| 字段 | 数据库真实列名，代码中保持一致 |'); $out.Add('| 类型 | PostgreSQL 信息架构返回类型 |')
$out.Add('| 可空 | YES 表示允许 NULL；NO 表示必须有值 |'); $out.Add('| 默认值 | 数据库默认表达式；— 表示没有默认值 |')
$out.Add('| 用途 | 通俗解释；未建立专门说明时按字段名归纳，标注“推断” |'); $out.Add('')

foreach ($group in ($rows | Group-Object table_name | Sort-Object Name)) {
    $tableName = [string]$group.Name
    $out.Add(('### {0}（{1}）' -f (Format-Code $tableName), (Get-Domain $tableName)))
    $out.Add(''); $out.Add('| 字段 | 类型 | 可空 | 默认值 | 用途 |'); $out.Add('|---|---|---|---|---|')
    foreach ($row in $group.Group) {
        $columnName = [string]$row.column_name
        $description = $common[$columnName]
        if (-not $description) {
            if ($columnName -match '(^|_)at$|_time$|timestamp') { $description = '时间字段（UTC，具体含义按表内状态解释）' }
            elseif ($columnName -match '(_id$|^id$)') { $description = '关联编号（推断）' }
            elseif ($columnName -match 'count|amount|quota|price|size|bytes|latency|duration') { $description = '数量、金额或度量字段（推断，单位以接口约定为准）' }
            elseif ($columnName -match 'token|secret|key|password') { $description = '敏感凭据或其引用；禁止明文输出（推断）' }
            else { $description = '业务字段（推断，需按该表业务流程补充）' }
        }

        $defaultValue = [string]$row.coalesce
        if ([string]::IsNullOrWhiteSpace($defaultValue)) { $defaultValue = '—' }
        $type = [string]$row.data_type
        if ($row.udt_name -and $type -eq 'USER-DEFINED') { $type = '{0} ({1})' -f $type, $row.udt_name }
        $out.Add("| $(Format-Code $columnName) | $(Escape-Markdown $type) | $($row.is_nullable) | $(Format-Code $defaultValue) | $(Escape-Markdown $description) |")
    }
    $out.Add('')
}

$out.Add('## 维护规则'); $out.Add('')
$out.Add('1. 新增业务数据先确定归属空间、所有者、生命周期、审计要求和删除策略，再加字段。')
$out.Add('2. 金额使用最小货币单位整数；时间使用 UTC `timestamptz`；跨请求写入必须有幂等编号。')
$out.Add('3. 密码、长期 Token、供应商密钥不进入普通业务字段；密钥只能存服务端加密密文或引用。')
$out.Add('4. 任何迁移必须更新 `MANIFEST.sha256.json`，并通过空库重放、数据库测试和恢复演练。')
$out.Add('5. 本文由项目迁移重建生成；如果线上数据库与项目迁移冲突，先核实差异再更新迁移或本文。')

$resolvedOutputPath = [IO.Path]::GetFullPath($OutputPath)
$outputDirectory = Split-Path -Parent $resolvedOutputPath
if (-not (Test-Path -LiteralPath $outputDirectory -PathType Container)) { throw "输出目录不存在：$outputDirectory" }
$preamble = $null
if (Test-Path -LiteralPath $resolvedOutputPath -PathType Leaf) {
    $existingContent = Get-Content -LiteralPath $resolvedOutputPath -Raw -Encoding utf8
    $sectionStart = $existingContent.IndexOf('## 数据分层', [StringComparison]::Ordinal)
    if ($sectionStart -lt 0) { throw '现有文档没有“## 数据分层”标记；为避免覆盖其他内容，已停止生成。' }
    $preamble = $existingContent.Substring(0, $sectionStart).TrimEnd()
    $preamble = $preamble -replace '\d+\s*个房间、\d+\s*件物品', ("{0}张表、{1}个字段" -f $tableCount, $rows.Count)
    $preamble = $preamble -replace '已导出\s*\d+\s*张表\s*\d+\s*个字段', ("按项目迁移重建 {0}张表、{1}个字段" -f $tableCount, $rows.Count)
    $preamble = $preamble -replace '> 来源：线上 `qingyu_business` 的 `app` schema。本文记录当前真实字段，不替代迁移文件；新增字段必须先写迁移，再更新本文。字段名和类型是数据库事实，中文用途说明中“推断”表示需要业务评审。', '> 来源：项目 `database/migrations` 中的数据库更新文件，从空库重建得到的 `app` schema。本文描述项目当前定义的结构，不代表线上数据库实时结构，也不替代迁移文件。'
}
else {
    $preamble = "# 轻域 PostgreSQL 字段数据字典`n`n> 来源：项目 ``database/migrations`` 中的数据库更新文件，从空库重建得到的 ``app`` schema。本文描述项目当前定义的结构，不代表线上数据库实时结构，也不替代迁移文件。`n`n### 现在长什么样`n按项目迁移重建 {0} 张表、{1} 个字段。`n" -f $tableCount, $rows.Count
}
('{0}{1}{2}' -f $preamble, "`n`n", ($out -join "`n")) | Set-Content -LiteralPath $resolvedOutputPath -Encoding utf8
Write-Output ("已生成字段数据字典：{0}；字段数：{1}；表/视图数：{2}" -f $resolvedOutputPath, $rows.Count, $tableCount)
