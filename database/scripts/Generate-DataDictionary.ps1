param(
    [string]$InputCsv = (Join-Path $PSScriptRoot '..\..\schema-columns.csv'),
    [string]$OutputPath = (Join-Path $PSScriptRoot '..\..\docs\需求规范\数据库字段数据字典.md')
)

$ErrorActionPreference = 'Stop'
$rows = Import-Csv -LiteralPath $InputCsv
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
function Get-Domain([string]$table) { foreach ($key in $domain.Keys) { if ($table.StartsWith($key)) { return $domain[$key] } }; return '其他业务表' }
function Escape-Markdown([string]$value) { return ($value -replace '\|', '\\|').Trim() }

$out = [System.Collections.Generic.List[string]]::new()
$out.Add('# 轻域 PostgreSQL 字段数据字典'); $out.Add('')
$out.Add('> 来源：线上 `qingyu_business` 的 `app` schema。本文记录当前真实字段，不替代迁移文件；新增字段必须先写迁移，再更新本文。字段名和类型是数据库事实，中文用途说明中“推断”表示需要业务评审。'); $out.Add('')
$out.Add('## 数据分层'); $out.Add('')
$out.Add('- **用户与安全**：账号、设备、会话、同意和安全事件。')
$out.Add('- **空间与多租户**：个人空间、团队空间和组织成员关系。所有业务数据必须沿 `workspace_id` 或专用授权关系隔离。')
$out.Add('- **订阅与计费**：套餐、订单、支付、订阅、退款、发票。支付事实不能用前端状态代替。')
$out.Add('- **额度与用量**：预占、结算、释放、流水和对账。余额是可重算结果，流水才是事实。')
$out.Add('- **内容与生成**：生成任务、结果、资产、文件、收藏、点赞和评论。')
$out.Add('- **平台运维**：模型目录、渠道、备份、恢复、管理员和系统设置。'); $out.Add('')
$out.Add('## 字段约定'); $out.Add(''); $out.Add('| 列 | 含义 |'); $out.Add('|---|---|')
$out.Add('| 表 | PostgreSQL 表或视图名 |'); $out.Add('| 字段 | 数据库真实列名，代码中保持一致 |'); $out.Add('| 类型 | PostgreSQL 信息架构返回类型 |')
$out.Add('| 可空 | YES 表示允许 NULL；NO 表示必须有值 |'); $out.Add('| 默认值 | 数据库默认表达式；空白表示没有默认值 |')
$out.Add('| 用途 | 通俗解释；未建立专门说明时按字段名归纳，标注“推断” |'); $out.Add('')

foreach ($group in ($rows | Group-Object table_name | Sort-Object Name)) {
    $table = $group.Name
    $out.Add("### `$table`（$(Get-Domain $table)）"); $out.Add(''); $out.Add('| 字段 | 类型 | 可空 | 默认值 | 用途 |'); $out.Add('|---|---|---|---|---|')
    foreach ($row in $group.Group) {
        $description = $common[$row.column_name]
        if (-not $description) {
            if ($row.column_name -match '(^|_)at$|_time$|timestamp') { $description = '时间字段（UTC，具体含义按表内状态解释）' }
            elseif ($row.column_name -match '(_id$|^id$)') { $description = '关联编号（推断）' }
            elseif ($row.column_name -match 'count|amount|quota|price|size|bytes|latency|duration') { $description = '数量、金额或度量字段（推断，单位以接口约定为准）' }
            elseif ($row.column_name -match 'token|secret|key|password') { $description = '敏感凭据或其引用；禁止明文输出（推断）' }
            else { $description = '业务字段（推断，需按该表业务流程补充）' }
        }
        $default = Escape-Markdown ([string]$row.coalesce); if (-not $default) { $default = '—' }
        $type = Escape-Markdown ([string]$row.data_type); if ($row.udt_name -and $row.data_type -eq 'USER-DEFINED') { $type = "$type ($($row.udt_name))" }
        $out.Add("| `$($row.column_name)` | $type | $($row.is_nullable) | `$default` | $description |")
    }
    $out.Add('')
}
$out.Add('## 维护规则'); $out.Add('')
$out.Add('1. 新增业务数据先确定归属空间、所有者、生命周期、审计要求和删除策略，再加字段。')
$out.Add('2. 金额使用最小货币单位整数；时间使用 UTC `timestamptz`；跨请求写入必须有幂等编号。')
$out.Add('3. 密码、长期 Token、供应商密钥不进入普通业务字段；密钥只能存服务端加密密文或引用。')
$out.Add('4. 任何迁移必须更新 `MANIFEST.sha256.json`，并通过空库重放、数据库测试和恢复演练。')
$out.Add('5. 本文由线上结构导出生成；如果迁移与本文冲突，以迁移执行结果为准，并立即修正文档。')
$out -join "`n" | Set-Content -LiteralPath $OutputPath -Encoding utf8
Write-Output "已生成字段数据字典：$OutputPath；字段数：$($rows.Count)；表/视图数：$(($rows | Group-Object table_name).Count)"
