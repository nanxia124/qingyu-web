-- RLS 策略依赖的判断函数必须可执行；函数本身只返回当前身份和是否有空间归属。
BEGIN;
SELECT pg_advisory_xact_lock(70420260923);
GRANT EXECUTE ON FUNCTION app.current_user_id() TO qingyu_app;
GRANT EXECUTE ON FUNCTION app.has_workspace_access(uuid) TO qingyu_app;
INSERT INTO app.schema_migrations(version, checksum)
VALUES ('0009_rls_function_execution', 'rls-function-execution-v1')
ON CONFLICT (version) DO NOTHING;
COMMIT;
