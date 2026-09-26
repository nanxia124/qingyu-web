-- 管理后台渠道可绑定多个上游模型，逗号拼接后可能超过 varchar(240)；与 base_url/api_key 一致改为 text。
BEGIN;
SELECT pg_advisory_xact_lock(70420260971);

ALTER TABLE app.platform_api_keys ALTER COLUMN model TYPE text;

INSERT INTO app.schema_migrations(version, checksum)
VALUES ('0071_platform_api_model_text', 'platform-api-model-text-v1')
ON CONFLICT (version) DO NOTHING;
COMMIT;
