-- 设备登录上限是产品规则：每个账号最多保留 3 台设备。
BEGIN;
SELECT pg_advisory_xact_lock(70420260923);

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM app.user_accounts
        WHERE max_active_sessions > 3
    ) THEN
        RAISE EXCEPTION '存在超过 3 台设备上限的账号，不能启用硬上限';
    END IF;
END;
$$;

ALTER TABLE app.user_accounts
    DROP CONSTRAINT IF EXISTS user_accounts_max_active_sessions_check;

ALTER TABLE app.user_accounts
    ADD CONSTRAINT user_accounts_max_active_sessions_check
    CHECK (max_active_sessions BETWEEN 1 AND 3);

INSERT INTO app.schema_migrations(version, checksum)
VALUES ('0042_session_limit_hard_cap', 'session-limit-hard-cap-v1')
ON CONFLICT (version) DO NOTHING;
COMMIT;
