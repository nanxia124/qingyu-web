-- Agent 会话同步使用外部消息/事件编号幂等写入，避免前端重复同步产生重复记录。
BEGIN;
SELECT pg_advisory_xact_lock(70420260923);

ALTER TABLE app.agent_event_logs ADD COLUMN IF NOT EXISTS external_event_id varchar(200);
CREATE UNIQUE INDEX IF NOT EXISTS agent_event_logs_external_idx
    ON app.agent_event_logs(thread_id, external_event_id)
    WHERE external_event_id IS NOT NULL;

INSERT INTO app.schema_migrations(version, checksum)
VALUES ('0027_agent_snapshot_sync', 'agent-snapshot-sync-v1')
ON CONFLICT (version) DO NOTHING;
COMMIT;
