-- 业务请求需要读取当前用户自己的工作空间，读取仍受 0006 的 RLS 保护。
BEGIN;
SELECT pg_advisory_xact_lock(70420260923);
GRANT SELECT ON app.workspaces TO qingyu_app;
INSERT INTO app.schema_migrations(version, checksum)
VALUES ('0008_business_read_boundary', 'business-read-boundary-v1')
ON CONFLICT (version) DO NOTHING;
COMMIT;
