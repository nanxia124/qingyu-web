-- 备份与恢复演练目录。真正的备份文件必须放在数据库之外的独立存储。
BEGIN;
SELECT pg_advisory_xact_lock(70420260923);

CREATE TABLE IF NOT EXISTS app.backup_runs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    backup_type text NOT NULL CHECK (backup_type IN ('logical','physical','wal_archive','config','object_manifest')),
    scope text NOT NULL,
    status text NOT NULL DEFAULT 'started' CHECK (status IN ('started','succeeded','failed','verified','expired')),
    source_database varchar(120) NOT NULL,
    schema_version varchar(80),
    storage_provider varchar(64) NOT NULL,
    storage_key text NOT NULL,
    checksum_sha256 char(64),
    size_bytes bigint CHECK (size_bytes IS NULL OR size_bytes >= 0),
    encryption_key_version varchar(120),
    base_backup_id uuid REFERENCES app.backup_runs(id) ON DELETE RESTRICT,
    wal_start_lsn pg_lsn,
    wal_end_lsn pg_lsn,
    started_at timestamptz NOT NULL DEFAULT now(),
    finished_at timestamptz,
    verified_at timestamptz,
    expires_at timestamptz,
    error_code varchar(120),
    error_message text,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK ((status IN ('succeeded','verified','expired') AND finished_at IS NOT NULL) OR status IN ('started','failed')),
    CHECK (verified_at IS NULL OR status = 'verified')
);

CREATE TABLE IF NOT EXISTS app.restore_drills (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    backup_id uuid NOT NULL REFERENCES app.backup_runs(id) ON DELETE RESTRICT,
    environment varchar(160) NOT NULL,
    status text NOT NULL DEFAULT 'started' CHECK (status IN ('started','passed','failed','cancelled')),
    target_time timestamptz,
    restored_at timestamptz,
    completed_at timestamptz,
    rpo_seconds bigint CHECK (rpo_seconds IS NULL OR rpo_seconds >= 0),
    rto_seconds bigint CHECK (rto_seconds IS NULL OR rto_seconds >= 0),
    checks jsonb NOT NULL DEFAULT '{}'::jsonb,
    difference_summary jsonb,
    error_message text,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK ((status='passed' AND completed_at IS NOT NULL AND restored_at IS NOT NULL) OR status <> 'passed')
);

CREATE INDEX IF NOT EXISTS backup_runs_status_idx ON app.backup_runs(status, started_at DESC);
CREATE INDEX IF NOT EXISTS backup_runs_expiry_idx ON app.backup_runs(expires_at) WHERE status IN ('succeeded','verified');
CREATE INDEX IF NOT EXISTS restore_drills_backup_idx ON app.restore_drills(backup_id, created_at DESC);

REVOKE ALL ON app.backup_runs, app.restore_drills FROM qingyu_app;
INSERT INTO app.schema_migrations(version, checksum)
VALUES ('0012_backup_catalog', 'backup-catalog-v1')
ON CONFLICT (version) DO NOTHING;
COMMIT;
