\set ON_ERROR_STOP on
BEGIN;
DO $$
DECLARE
    user_a uuid;
    user_b uuid;
    workspace_a uuid;
    workspace_b uuid;
    task_a uuid;
    task_b uuid;
    attempt_a uuid;
    attempt_b uuid;
    file_a uuid;
    file_b uuid;
BEGIN
    INSERT INTO app.user_accounts(appwrite_user_id)
    VALUES ('generation-slot-test-' || gen_random_uuid()) RETURNING id INTO user_a;
    INSERT INTO app.workspaces(type, owner_user_id, name)
    VALUES ('personal', user_a, 'Generation slot A') RETURNING id INTO workspace_a;
    INSERT INTO app.user_accounts(appwrite_user_id)
    VALUES ('generation-slot-test-' || gen_random_uuid()) RETURNING id INTO user_b;
    INSERT INTO app.workspaces(type, owner_user_id, name)
    VALUES ('personal', user_b, 'Generation slot B') RETURNING id INTO workspace_b;

    INSERT INTO app.generation_tasks(workspace_id, task_type, status, request_id, idempotency_key, requested_output_count)
    VALUES (workspace_a, 'image', 'pending', 'slot-req-' || gen_random_uuid(), 'slot-task-' || gen_random_uuid(), 3)
    RETURNING id INTO task_a;
    INSERT INTO app.generation_tasks(workspace_id, task_type, status, request_id, idempotency_key)
    VALUES (workspace_b, 'image', 'pending', 'slot-req-' || gen_random_uuid(), 'slot-task-' || gen_random_uuid())
    RETURNING id INTO task_b;
    INSERT INTO app.file_objects(workspace_id, storage_provider, bucket, object_key,
                                 media_type, source_kind)
    VALUES (workspace_a, 'cos', 'test', gen_random_uuid()::text, 'image', 'generated') RETURNING id INTO file_a;
    INSERT INTO app.file_objects(workspace_id, storage_provider, bucket, object_key,
                                 media_type, source_kind)
    VALUES (workspace_a, 'cos', 'test', gen_random_uuid()::text, 'image', 'generated') RETURNING id INTO file_b;

    INSERT INTO app.generation_attempts(workspace_id, task_id, attempt_no, provider)
    VALUES (workspace_a, task_a, 1, 'test-provider') RETURNING id INTO attempt_a;
    INSERT INTO app.generation_attempts(workspace_id, task_id, attempt_no, provider)
    VALUES (workspace_b, task_b, 1, 'test-provider') RETURNING id INTO attempt_b;

    BEGIN
        INSERT INTO app.generation_attempts(workspace_id, task_id, attempt_no, provider)
        VALUES (workspace_a, task_a, 1, 'test-provider-retry');
        RAISE EXCEPTION '重复任务尝试编号未被拒绝';
    EXCEPTION WHEN unique_violation THEN NULL; END;

    BEGIN
        UPDATE app.generation_tasks SET requested_output_count = -1 WHERE id = task_a;
        RAISE EXCEPTION '负数请求输出数量未被拒绝';
    EXCEPTION WHEN check_violation THEN NULL; END;
    -- 先登记空槽位；供应商输出可能乱序，位置始终由 output_index 决定。
    INSERT INTO app.generation_outputs(task_id, workspace_id, attempt_id, output_index,
                                       provider_output_id, availability, output_type)
    VALUES (task_a, workspace_a, attempt_a, 2, 'provider-output-2', 'awaiting', 'image');
    INSERT INTO app.generation_outputs(task_id, workspace_id, attempt_id, output_index,
                                       provider_output_id, availability, output_type, file_id)
    VALUES (task_a, workspace_a, attempt_a, 0, 'provider-output-0', 'available', 'image', file_a);

    BEGIN
        INSERT INTO app.generation_outputs(task_id, workspace_id, attempt_id, output_index,
                                           availability, output_type)
        VALUES (task_a, workspace_a, attempt_a, 0, 'awaiting', 'image');
        RAISE EXCEPTION '重复输出槽位未被拒绝';
    EXCEPTION WHEN unique_violation THEN NULL; END;

    BEGIN
        INSERT INTO app.generation_outputs(task_id, workspace_id, attempt_id, output_index,
                                           provider_output_id, availability, output_type)
        VALUES (task_a, workspace_a, attempt_a, 3, 'provider-output-0', 'available', 'image');
        RAISE EXCEPTION '重复供应商输出编号未被拒绝';
    EXCEPTION WHEN unique_violation THEN NULL; END;

    BEGIN
        INSERT INTO app.generation_outputs(task_id, workspace_id, attempt_id, output_index,
                                           availability, output_type)
        VALUES (task_a, workspace_a, attempt_a, 4, NULL, 'image');
        RAISE EXCEPTION '缺少输出可用状态未被拒绝';
    EXCEPTION WHEN check_violation THEN NULL; END;

    BEGIN
        INSERT INTO app.generation_outputs(task_id, workspace_id, attempt_id, output_index,
                                           availability, output_type)
        VALUES (task_b, workspace_b, attempt_a, 7, 'awaiting', 'image');
        RAISE EXCEPTION '跨空间或跨任务尝试关联未被拒绝';
    EXCEPTION WHEN foreign_key_violation THEN NULL; END;

    INSERT INTO app.generation_outputs(task_id, workspace_id, attempt_id, output_index,
                                       availability, output_type, file_id)
    VALUES (task_a, workspace_a, attempt_a, 1, 'available', 'image', file_b);
    BEGIN
        INSERT INTO app.generation_outputs(task_id, workspace_id, attempt_id, output_index,
                                           availability, output_type, file_id)
        VALUES (task_a, workspace_a, attempt_a, 5, 'available', 'image', file_a);
        RAISE EXCEPTION '同任务重复使用同一输出文件未被拒绝';
    EXCEPTION WHEN unique_violation THEN NULL; END;

    BEGIN
        UPDATE app.generation_attempts SET response_complete = true WHERE id = attempt_a;
        RAISE EXCEPTION '未知输出数量被误记为完整响应';
    EXCEPTION WHEN check_violation THEN NULL; END;
    UPDATE app.generation_attempts
       SET returned_output_count = 3, response_complete = true, finished_at = now()
     WHERE id = attempt_a;

    PERFORM set_config('test.generation_slot_user_a', user_a::text, true);
    PERFORM set_config('test.generation_slot_attempt_a', attempt_a::text, true);
    PERFORM set_config('test.generation_slot_attempt_b', attempt_b::text, true);

    RAISE NOTICE 'PASS: 调用尝试归属、稳定输出槽位、乱序映射、重复防护与响应完整度';
END $$;

SET LOCAL ROLE qingyu_app;
SELECT set_config('app.user_id', current_setting('test.generation_slot_user_a'), true);
DO $$
BEGIN
    IF (SELECT count(*) FROM app.generation_attempts
        WHERE id = current_setting('test.generation_slot_attempt_a')::uuid) <> 1 THEN
        RAISE EXCEPTION '尝试所属空间的用户读取不到自己的记录';
    END IF;
    IF (SELECT count(*) FROM app.generation_attempts
        WHERE id = current_setting('test.generation_slot_attempt_b')::uuid) <> 0 THEN
        RAISE EXCEPTION '尝试行级安全泄露了其他空间记录';
    END IF;
END $$;
RESET ROLE;
ROLLBACK;
