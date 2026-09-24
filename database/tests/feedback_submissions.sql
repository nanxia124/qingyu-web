-- 验证反馈不会被当成无约束文本丢进库；全部操作在事务中回滚。
BEGIN;

DO $$
DECLARE
    test_user uuid;
    test_workspace uuid;
    feedback_id uuid;
    rejected boolean := false;
BEGIN
    INSERT INTO app.user_accounts(appwrite_user_id, email)
    VALUES ('feedback-test-' || gen_random_uuid(), 'feedback@example.invalid')
    RETURNING id INTO test_user;
    INSERT INTO app.workspaces(type, owner_user_id, name)
    VALUES ('personal', test_user, '反馈测试空间')
    RETURNING id INTO test_workspace;

    INSERT INTO app.feedback_submissions(user_id, workspace_id, feedback_type, content, contact)
    VALUES (test_user, test_workspace, 'bug', '登录后页面没有加载出来', 'feedback@example.invalid')
    RETURNING id INTO feedback_id;

    IF NOT EXISTS (
        SELECT 1 FROM app.feedback_submissions
        WHERE id = feedback_id AND status = 'pending' AND user_id = test_user AND workspace_id = test_workspace
    ) THEN
        RAISE EXCEPTION '反馈没有按用户和工作空间正确落库';
    END IF;

    BEGIN
        INSERT INTO app.feedback_submissions(feedback_type, content)
        VALUES ('unknown', '无效类型');
    EXCEPTION WHEN check_violation THEN
        rejected := true;
    END;
    IF NOT rejected THEN RAISE EXCEPTION '无效反馈类型没有被拒绝'; END IF;

    rejected := false;
    BEGIN
        UPDATE app.feedback_submissions
        SET status = 'resolved'
        WHERE id = feedback_id;
    EXCEPTION WHEN check_violation THEN
        rejected := true;
    END;
    IF NOT rejected THEN RAISE EXCEPTION '已解决反馈缺少处理时间仍被允许'; END IF;

    UPDATE app.feedback_submissions
    SET status = 'resolved', handled_by = test_user, handled_at = now(), resolution = '已处理'
    WHERE id = feedback_id;
    IF NOT EXISTS (SELECT 1 FROM app.feedback_submissions WHERE id = feedback_id AND status = 'resolved' AND handled_at IS NOT NULL) THEN
        RAISE EXCEPTION '反馈处理状态没有正确保存';
    END IF;
    RAISE NOTICE 'PASS: 反馈落库、类型校验、处理状态和归属字段有效';
END;
$$;

ROLLBACK;
