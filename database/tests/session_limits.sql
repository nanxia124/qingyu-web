-- 验证设备上限和在线唯一性规则。整个测试最后回滚，不留下测试数据。
BEGIN;

DO $$
DECLARE
    test_user uuid;
    test_device uuid;
    test_session uuid;
    i integer;
    rejected boolean := false;
BEGIN
    INSERT INTO app.user_accounts(appwrite_user_id, max_active_sessions)
    VALUES ('session-limit-test-' || gen_random_uuid(), 3)
    RETURNING id INTO test_user;

    INSERT INTO app.user_devices(user_id, installation_id)
    VALUES (test_user, gen_random_uuid())
    RETURNING id INTO test_device;
    INSERT INTO app.user_sessions(user_id, device_id, provider_session_id, admission_status, is_online, expires_at)
    VALUES (test_user, test_device, 'session-limit-test-1', 'active', true, now() + interval '1 hour')
    RETURNING id INTO test_session;

    BEGIN
        INSERT INTO app.user_devices(user_id, installation_id)
        VALUES (test_user, gen_random_uuid())
        RETURNING id INTO test_device;
        INSERT INTO app.user_sessions(user_id, device_id, provider_session_id, admission_status, is_online, expires_at)
        VALUES (test_user, test_device, 'session-limit-test-online-2', 'active', true, now() + interval '1 hour');
        RAISE EXCEPTION '同一账号出现了第二个在线会话';
    EXCEPTION WHEN unique_violation THEN
        NULL;
    END;

    FOR i IN 2..3 LOOP
        INSERT INTO app.user_devices(user_id, installation_id)
        VALUES (test_user, gen_random_uuid())
        RETURNING id INTO test_device;
        INSERT INTO app.user_sessions(user_id, device_id, provider_session_id, admission_status, is_online, expires_at)
        VALUES (test_user, test_device, 'session-limit-test-' || i, 'active', false, now() + interval '1 hour');
    END LOOP;

    IF (SELECT count(*) FROM app.user_sessions WHERE user_id = test_user AND admission_status = 'active' AND is_online) <> 1 THEN
        RAISE EXCEPTION '同一账号在线会话数量不是 1';
    END IF;

    SET CONSTRAINTS app.user_sessions_count_guard IMMEDIATE;
    BEGIN
        INSERT INTO app.user_devices(user_id, installation_id)
        VALUES (test_user, gen_random_uuid())
        RETURNING id INTO test_device;
        INSERT INTO app.user_sessions(user_id, device_id, provider_session_id, admission_status, is_online, expires_at)
        VALUES (test_user, test_device, 'session-limit-test-4', 'active', false, now() + interval '1 hour');
    EXCEPTION WHEN others THEN
        IF SQLERRM LIKE '%超过上限%' THEN
            rejected := true;
        ELSE
            RAISE;
        END IF;
    END;
    IF NOT rejected THEN
        RAISE EXCEPTION '第 4 台有效设备没有被拒绝';
    END IF;
END;
$$;

ROLLBACK;
