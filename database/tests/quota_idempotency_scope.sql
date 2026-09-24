-- 幂等键重试必须仍然属于同一额度范围；测试结束回滚。
BEGIN;

DO $$
DECLARE
    uid uuid;
    wid uuid;
    account uuid;
    reservation uuid;
    daily_reservation uuid;
    rejected boolean := false;
BEGIN
    INSERT INTO app.user_accounts(appwrite_user_id)
    VALUES ('quota-idempotency-test-' || gen_random_uuid())
    RETURNING id INTO uid;
    INSERT INTO app.workspaces(type, owner_user_id, name)
    VALUES ('personal', uid, '额度幂等测试空间')
    RETURNING id INTO wid;
    INSERT INTO app.quota_accounts(workspace_id, quota_code, granted)
    VALUES (wid, 'monthly', 10)
    RETURNING id INTO account;

    PERFORM set_config('app.user_id', uid::text, true);
    SELECT app.reserve_quota(wid, 'monthly', 1, 'quota-scope-key', now() + interval '10 minutes') INTO reservation;
    BEGIN
        PERFORM app.reserve_quota(wid, 'monthly', 2, 'quota-scope-key', now() + interval '10 minutes');
    EXCEPTION WHEN others THEN
        IF SQLERRM LIKE '%幂等键已用于其他%' THEN rejected := true; ELSE RAISE; END IF;
    END;
    IF NOT rejected THEN RAISE EXCEPTION '额度预占没有拒绝金额不一致的幂等重试'; END IF;

    rejected := false;
    SELECT app.reserve_free_daily_usage(wid, uid, 'ai_proxy', 1, 'daily-scope-key', 20, now() + interval '10 minutes') INTO daily_reservation;
    BEGIN
        PERFORM app.reserve_free_daily_usage(wid, uid, 'image', 1, 'daily-scope-key', 20, now() + interval '10 minutes');
    EXCEPTION WHEN others THEN
        IF SQLERRM LIKE '%幂等键已用于其他%' THEN rejected := true; ELSE RAISE; END IF;
    END;
    IF NOT rejected THEN RAISE EXCEPTION '每日额度预占没有拒绝功能不一致的幂等重试'; END IF;
END;
$$;

ROLLBACK;
