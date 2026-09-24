-- 为新环境补齐业务数据库角色的 schema 使用权限。
-- 生产环境可能已经由初始化脚本授予，但必须纳入迁移，保证空库重建和托管 PostgreSQL 一致。
BEGIN;

GRANT USAGE ON SCHEMA app TO qingyu_app, qingyu_api;

INSERT INTO app.schema_migrations(version, checksum)
VALUES ('0048_database_role_schema_usage', 'database-role-schema-usage-v1')
ON CONFLICT (version) DO NOTHING;

COMMIT;
