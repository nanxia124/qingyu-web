-- 验证无效、过期和撤销会话不能保持在线标记。
BEGIN;

DO $$
DECLARE
    test_user uuid;
    test_device uuid;
BEGIN
    INSERT INTO app.user_accounts(appwrite_user_id) VALUES ('session-online-guard-' || gen_random_uuid()) RETURNING id INTO test_user;
    INSERT INTO app.user_devices(user_id, installation_id) VALUES (test_user, gen_random_uuid()) RETURNING id INTO test_device;
    INSERT INTO app.user_sessions(user_id, device_id, provider_session_id, admission_status, is_online, expires_at)
    VALUES (test_user, test_device, 'expired-guard', 'active', true, now() - interval '1 minute');
    IF EXISTS (SELECT 1 FROM app.user_sessions WHERE user_id=test_user AND is_online) THEN
        RAISE EXCEPTION '过期会话仍被标记为在线';
    END IF;
    RAISE NOTICE 'PASS: 过期和无效会话不会保持在线标记';
END;
$$;

ROLLBACK;
