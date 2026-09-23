-- 业务连接账号权限边界
-- qingyu_app 只用于运行受控业务请求；数据库管理员 user 才能改表结构、权限和恢复数据。
-- 本迁移不删除任何业务数据。
BEGIN;

SELECT pg_advisory_xact_lock(70420260923);

REVOKE ALL ON ALL TABLES IN SCHEMA app FROM qingyu_app;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA app FROM qingyu_app;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app FROM qingyu_app;
GRANT USAGE ON SCHEMA app TO qingyu_app;

-- 普通业务连接只处理内容类表。成员、身份、权限、支付、配额和审计均必须由后端受控函数写入。
GRANT SELECT, INSERT, UPDATE, DELETE ON
    app.assets,
    app.asset_versions,
    app.asset_files,
    app.asset_shares,
    app.asset_references,
    app.asset_likes,
    app.asset_comments,
    app.moderation_records,
    app.collections,
    app.collection_items,
    app.file_objects,
    app.generation_tasks,
    app.generation_outputs,
    app.ai_channels,
    app.canvas_projects,
    app.canvas_nodes,
    app.canvas_connections,
    app.canvas_chat_sessions,
    app.canvas_chat_messages,
    app.agent_threads,
    app.agent_messages,
    app.agent_event_logs,
    app.notifications
TO qingyu_app;

-- 用户自己的偏好和同意记录允许业务读取，但仍由下一段行级策略限制到当前用户。
GRANT SELECT, INSERT, UPDATE ON app.user_preferences, app.consent_records TO qingyu_app;

ALTER TABLE app.user_preferences ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_preference_self_isolation ON app.user_preferences;
CREATE POLICY user_preference_self_isolation ON app.user_preferences
    USING (user_id = app.current_user_id())
    WITH CHECK (user_id = app.current_user_id());

ALTER TABLE app.consent_records ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS consent_self_isolation ON app.consent_records;
CREATE POLICY consent_self_isolation ON app.consent_records
    USING (user_id = app.current_user_id())
    WITH CHECK (user_id = app.current_user_id());

ALTER TABLE app.notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS notification_self_isolation ON app.notifications;
CREATE POLICY notification_self_isolation ON app.notifications
    USING (user_id = app.current_user_id())
    WITH CHECK (user_id = app.current_user_id());

INSERT INTO app.schema_migrations(version, checksum)
VALUES ('0007_security_boundary', 'security-boundary-v1')
ON CONFLICT (version) DO NOTHING;
COMMIT;
