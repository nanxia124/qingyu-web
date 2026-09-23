-- 管理后台的供应商 API 渠道统一进入 PostgreSQL，避免只保存在服务器 JSON 文件里。
BEGIN;
SELECT pg_advisory_xact_lock(70420260923);

CREATE TABLE IF NOT EXISTS app.platform_api_keys (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name varchar(120) NOT NULL,
    provider varchar(80) NOT NULL DEFAULT 'openai',
    base_url text NOT NULL,
    api_key text NOT NULL,
    model varchar(160) NOT NULL DEFAULT '',
    max_concurrency integer CHECK (max_concurrency IS NULL OR max_concurrency > 0),
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS platform_api_keys_active_idx ON app.platform_api_keys(is_active, updated_at DESC);

INSERT INTO app.schema_migrations(version, checksum)
VALUES ('0023_platform_api_keys', 'platform-api-keys-v1')
ON CONFLICT (version) DO NOTHING;
COMMIT;
