-- 为每次供应商调用保存完成时间和延迟，避免后台只能看到成功/失败而无法定位卡顿。
BEGIN;
SELECT pg_advisory_xact_lock(70420260923);

ALTER TABLE app.usage_records
    ADD COLUMN IF NOT EXISTS completed_at timestamptz,
    ADD COLUMN IF NOT EXISTS latency_ms integer CHECK (latency_ms IS NULL OR latency_ms >= 0);

CREATE INDEX IF NOT EXISTS usage_records_channel_time_idx
    ON app.usage_records ((metadata->>'channelId'), occurred_at DESC)
    WHERE metadata ? 'channelId';

INSERT INTO app.schema_migrations(version, checksum)
VALUES ('0052_usage_completion_metrics', 'usage-completion-metrics-v1')
ON CONFLICT (version) DO NOTHING;
COMMIT;
