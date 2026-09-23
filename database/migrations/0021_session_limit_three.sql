-- 默认每个账号最多同时在线 3 台不同设备；第 4 台登录时踢出最早的一台。
BEGIN;
SELECT pg_advisory_xact_lock(70420260923);

ALTER TABLE app.user_accounts
    ALTER COLUMN max_active_sessions SET DEFAULT 3;

-- 之前使用旧默认值 5、且没有单独配置过的账号，统一收敛到新的默认上限。
UPDATE app.user_accounts
   SET max_active_sessions = 3,
       updated_at = now()
 WHERE max_active_sessions = 5;

INSERT INTO app.schema_migrations(version, checksum)
VALUES ('0021_session_limit_three', 'session-limit-three-v1')
ON CONFLICT (version) DO NOTHING;
COMMIT;
