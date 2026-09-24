-- 一份本地备份可以有多个独立副本，例如服务器本地和腾讯云 COS。
-- 副本记录与备份本体分开，避免把“已生成”误当成“异机已保存”。
BEGIN;
SELECT pg_advisory_xact_lock(70420260923);

CREATE TABLE IF NOT EXISTS app.backup_copies (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    backup_id uuid NOT NULL REFERENCES app.backup_runs(id) ON DELETE RESTRICT,
    storage_provider varchar(64) NOT NULL,
    storage_key text NOT NULL,
    status text NOT NULL DEFAULT 'started' CHECK (status IN ('started','uploaded','verified','failed','expired')),
    checksum_sha256 char(64),
    size_bytes bigint CHECK (size_bytes IS NULL OR size_bytes >= 0),
    uploaded_at timestamptz,
    verified_at timestamptz,
    expires_at timestamptz,
    error_message text,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (backup_id, storage_provider, storage_key),
    CHECK ((status IN ('uploaded','verified') AND uploaded_at IS NOT NULL) OR status IN ('started','failed','expired')),
    CHECK (verified_at IS NULL OR status = 'verified')
);

CREATE INDEX IF NOT EXISTS backup_copies_status_idx ON app.backup_copies(status, created_at DESC);
CREATE INDEX IF NOT EXISTS backup_copies_backup_idx ON app.backup_copies(backup_id, created_at DESC);
REVOKE ALL ON app.backup_copies FROM qingyu_app;

INSERT INTO app.schema_migrations(version, checksum)
VALUES ('0033_backup_copies', 'backup-copies-v1')
ON CONFLICT (version) DO NOTHING;
COMMIT;
