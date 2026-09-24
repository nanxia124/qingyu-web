-- 设备会话上限由数据库兜底，避免并发或后台直写绕过最多 3 台设备的规则。
BEGIN;
SELECT pg_advisory_xact_lock(70420260923);

CREATE OR REPLACE FUNCTION app.validate_session_count()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    allowed_count integer;
    current_count integer;
BEGIN
    SELECT max_active_sessions INTO allowed_count
    FROM app.user_accounts
    WHERE id = NEW.user_id;

    SELECT count(*) INTO current_count
    FROM app.user_sessions
    WHERE user_id = NEW.user_id
      AND admission_status IN ('pending', 'active')
      AND expires_at > now();

    IF current_count > COALESCE(allowed_count, 3) THEN
        RAISE EXCEPTION '账号有效设备会话数超过上限（最多 % 台）', COALESCE(allowed_count, 3);
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS user_sessions_count_guard ON app.user_sessions;
CREATE CONSTRAINT TRIGGER user_sessions_count_guard
    AFTER INSERT OR UPDATE OF user_id, admission_status, expires_at
    ON app.user_sessions
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW
    EXECUTE FUNCTION app.validate_session_count();

INSERT INTO app.schema_migrations(version, checksum)
VALUES ('0043_session_count_guard', 'session-count-guard-v1')
ON CONFLICT (version) DO NOTHING;
COMMIT;
