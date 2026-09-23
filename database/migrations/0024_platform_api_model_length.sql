-- 供应商模型名称可能带有较长版本后缀，放宽管理后台渠道模型字段。
BEGIN;
SELECT pg_advisory_xact_lock(70420260923);
ALTER TABLE app.platform_api_keys ALTER COLUMN model TYPE varchar(240);
INSERT INTO app.schema_migrations(version, checksum)
VALUES ('0024_platform_api_model_length', 'platform-api-model-length-v1')
ON CONFLICT (version) DO NOTHING;
COMMIT;
