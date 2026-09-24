BEGIN;
DO $$
DECLARE
    user_id uuid := gen_random_uuid();
    workspace_id uuid := gen_random_uuid();
    usage_id uuid;
BEGIN
    INSERT INTO app.user_accounts(id, appwrite_user_id, email) VALUES (user_id, 'metrics-' || user_id, 'metrics@example.com');
    INSERT INTO app.workspaces(id, type, owner_user_id, name) VALUES (workspace_id, 'personal', user_id, '指标测试空间');
    INSERT INTO app.usage_records(workspace_id, user_id, feature_code, quantity, unit, result, idempotency_key, metadata)
    VALUES (workspace_id, user_id, 'ai_proxy', 1, 'request', 'reserved', 'metrics-' || user_id, '{"channelId":"test-channel","targetPath":"/images/generations"}')
    RETURNING id INTO usage_id;
    UPDATE app.usage_records
       SET result='committed', completed_at=now(), latency_ms=123
     WHERE id=usage_id;
    IF NOT EXISTS (SELECT 1 FROM app.usage_records WHERE id=usage_id AND completed_at IS NOT NULL AND latency_ms=123) THEN
        RAISE EXCEPTION '调用完成指标没有保存';
    END IF;
    BEGIN
        UPDATE app.usage_records SET latency_ms=-1 WHERE id=usage_id;
        RAISE EXCEPTION '负延迟没有被拒绝';
    EXCEPTION WHEN check_violation THEN
        NULL;
    END;
    RAISE NOTICE 'PASS: 调用完成时间和延迟可记录，负延迟被拒绝';
END $$;
ROLLBACK;
