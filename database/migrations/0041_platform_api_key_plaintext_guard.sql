-- 平台 API 密钥只允许保存加密密文，禁止明文回写。
BEGIN;
SELECT pg_advisory_xact_lock(70420260923);

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM app.platform_api_keys
        WHERE api_key IS NOT NULL
    ) THEN
        RAISE EXCEPTION 'platform_api_keys 仍有明文 API Key，不能启用明文禁止约束';
    END IF;
END;
$$;

ALTER TABLE app.platform_api_keys
    DROP CONSTRAINT IF EXISTS platform_api_keys_plaintext_forbidden;

ALTER TABLE app.platform_api_keys
    ADD CONSTRAINT platform_api_keys_plaintext_forbidden
    CHECK (api_key IS NULL);

INSERT INTO app.schema_migrations(version, checksum)
VALUES ('0041_platform_api_key_plaintext_guard', 'platform-api-key-plaintext-guard-v1')
ON CONFLICT (version) DO NOTHING;
COMMIT;
