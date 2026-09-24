-- 验证所有结果结束路径都会自动补齐完成时间和延迟。
BEGIN;

DO $$
DECLARE
    test_user uuid;
    test_workspace uuid;
    test_usage uuid;
    row_data record;
BEGIN
    INSERT INTO app.user_accounts(appwrite_user_id)
    VALUES ('usage-completion-guard-' || gen_random_uuid())
    RETURNING id INTO test_user;
    INSERT INTO app.workspaces(type, owner_user_id, name)
    VALUES ('personal', test_user, '调用完成保护测试')
    RETURNING id INTO test_workspace;
    INSERT INTO app.usage_records(workspace_id, user_id, feature_code, quantity, unit, result, idempotency_key, occurred_at)
    VALUES (test_workspace, test_user, 'guard-test', 1, 'request', 'reserved', 'guard-' || gen_random_uuid(), now() - interval '2 seconds')
    RETURNING id INTO test_usage;

    UPDATE app.usage_records SET result='committed' WHERE id=test_usage;
    SELECT completed_at, latency_ms INTO row_data FROM app.usage_records WHERE id=test_usage;
    IF row_data.completed_at IS NULL OR row_data.latency_ms IS NULL OR row_data.latency_ms < 0 THEN
        RAISE EXCEPTION '结束状态没有自动补齐完成时间和延迟';
    END IF;
    RAISE NOTICE 'PASS: 结束状态自动补齐完成时间和延迟';
END;
$$;

ROLLBACK;
