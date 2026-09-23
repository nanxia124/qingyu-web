# PostgreSQL 数据库迁移

目标数据库是腾讯云轻量服务器上的 `qingyu_business`。迁移文件按编号执行，先执行小编号，再执行大编号。每次执行都要在 `app.schema_migrations` 留下版本记录。

`0001_foundation.sql` 是第一版基础骨架，包含用户身份映射、空间、团队成员、角色权限、设备会话、安全审计和 outbox 事件。它不保存密码，也不包含 Appwrite 的表。

正式应用连接必须使用独立的业务数据库角色，不能长期复用 Appwrite 的 `user` 角色。前端不能直接连接 PostgreSQL；迁移、回滚和备份由服务器端受控执行。
