-- 同一账号可保留最多 3 台已登录设备，但同一时间只允许 1 台在线操作。
BEGIN;
SELECT pg_advisory_xact_lock(70420260923);

ALTER TABLE app.user_sessions
    ADD COLUMN IF NOT EXISTS is_online boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS user_sessions_one_online_idx
    ON app.user_sessions(user_id)
    WHERE admission_status = 'active' AND is_online = true;

INSERT INTO app.schema_migrations(version, checksum)
VALUES ('0022_single_online_session', 'single-online-session-v1')
ON CONFLICT (version) DO NOTHING;
COMMIT;
