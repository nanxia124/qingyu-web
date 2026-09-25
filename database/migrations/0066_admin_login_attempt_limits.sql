-- 管理员登录限速必须跨 API 进程和重启保持；仅保存账号的 SHA-256 摘要，不保存原始账号。
BEGIN;
SELECT pg_advisory_xact_lock(70420260923);

CREATE TABLE IF NOT EXISTS app.admin_login_attempt_limits (
    account_key char(64) PRIMARY KEY CHECK (account_key ~ '^[a-f0-9]{64}$'),
    attempt_count smallint NOT NULL CHECK (attempt_count BETWEEN 1 AND 11),
    window_started_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS admin_login_attempt_limits_window_idx
    ON app.admin_login_attempt_limits(window_started_at);

GRANT SELECT, INSERT, UPDATE, DELETE ON app.admin_login_attempt_limits TO qingyu_api;
REVOKE ALL ON app.admin_login_attempt_limits FROM qingyu_app;

INSERT INTO app.schema_migrations(version, checksum)
VALUES ('0066_admin_login_attempt_limits', 'admin-login-attempt-limits-v1')
ON CONFLICT (version) DO NOTHING;
COMMIT;
