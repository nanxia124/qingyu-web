-- 会话只有在 active 且未过期时才能标记为在线。
BEGIN;
SELECT pg_advisory_xact_lock(70420260923);

CREATE OR REPLACE FUNCTION app.normalize_session_online_state()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.admission_status <> 'active' OR NEW.expires_at <= now() THEN
        NEW.is_online := false;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS user_session_online_guard ON app.user_sessions;
CREATE TRIGGER user_session_online_guard
    BEFORE INSERT OR UPDATE OF admission_status, expires_at, is_online ON app.user_sessions
    FOR EACH ROW EXECUTE FUNCTION app.normalize_session_online_state();

REVOKE ALL ON FUNCTION app.normalize_session_online_state() FROM PUBLIC, qingyu_app;
GRANT EXECUTE ON FUNCTION app.normalize_session_online_state() TO qingyu_api;

INSERT INTO app.schema_migrations(version, checksum)
VALUES ('0055_session_online_guard', 'session-online-guard-v1')
ON CONFLICT (version) DO NOTHING;
COMMIT;
