-- 供应商密钥只保留加密密文；明文列仅作为一次性升级入口，应用迁移后会清空。
BEGIN;
SELECT pg_advisory_xact_lock(70420260923);

ALTER TABLE app.platform_api_keys
    ADD COLUMN IF NOT EXISTS api_key_ciphertext text;
ALTER TABLE app.platform_api_keys
    ALTER COLUMN api_key DROP NOT NULL;

INSERT INTO app.schema_migrations(version, checksum)
VALUES ('0025_encrypt_platform_api_keys', 'encrypt-platform-api-keys-v1')
ON CONFLICT (version) DO NOTHING;
COMMIT;
