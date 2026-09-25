\set ON_ERROR_STOP on
BEGIN;
DO $$
DECLARE
    user_a uuid;
    user_b uuid;
    workspace_a uuid;
    workspace_b uuid;
    original_file uuid;
    other_file uuid;
    edited_file uuid;
    edit_a uuid;
    edit_b uuid;
    edit_key text;
    asset_a uuid;
    asset_b uuid;
    version_a uuid;
    version_b uuid;
    project_a uuid;
    node_a uuid;
    session_a uuid;
    session_b uuid;
    job_key text;
    task_a uuid;
    task_b uuid;
    attempt_a uuid;
    attempt_b uuid;
    output_a uuid;
    output_b uuid;
    job_a uuid;
    job_b uuid;
    recovery_job uuid;
    retry_job uuid;
    cancel_job uuid;
BEGIN
    INSERT INTO app.user_accounts(appwrite_user_id)
    VALUES ('file-job-test-' || gen_random_uuid()) RETURNING id INTO user_a;
    INSERT INTO app.workspaces(type, owner_user_id, name)
    VALUES ('personal', user_a, 'File job workspace A') RETURNING id INTO workspace_a;
    INSERT INTO app.user_accounts(appwrite_user_id)
    VALUES ('file-job-test-' || gen_random_uuid()) RETURNING id INTO user_b;
    INSERT INTO app.workspaces(type, owner_user_id, name)
    VALUES ('personal', user_b, 'File job workspace B') RETURNING id INTO workspace_b;

    INSERT INTO app.file_objects(workspace_id, storage_provider, bucket, object_key,
                                 media_type, source_kind)
    VALUES (workspace_a, 'cos', 'test', gen_random_uuid()::text, 'image', 'generated')
    RETURNING id INTO original_file;
    INSERT INTO app.file_objects(workspace_id, storage_provider, bucket, object_key,
                                 media_type, source_kind)
    VALUES (workspace_b, 'cos', 'test', gen_random_uuid()::text, 'image', 'generated')
    RETURNING id INTO other_file;

    edit_key := 'edit-' || gen_random_uuid();
    INSERT INTO app.content_edits(workspace_id, created_by, idempotency_key)
    VALUES (workspace_a, user_a, edit_key) RETURNING id INTO edit_a;
    INSERT INTO app.content_edits(workspace_id, created_by, idempotency_key)
    VALUES (workspace_b, user_b, 'edit-' || gen_random_uuid()) RETURNING id INTO edit_b;
    BEGIN
        INSERT INTO app.content_edits(workspace_id, created_by, idempotency_key)
        VALUES (workspace_a, user_a, edit_key);
        RAISE EXCEPTION '重复编辑幂等键未被拒绝';
    EXCEPTION WHEN unique_violation THEN NULL; END;
    INSERT INTO app.file_objects(workspace_id, storage_provider, bucket, object_key,
                                 media_type, source_kind, source_file_id, edit_id)
    VALUES (workspace_a, 'cos', 'test', gen_random_uuid()::text,
            'image', 'edited', original_file, edit_a) RETURNING id INTO edited_file;
    INSERT INTO app.content_edit_inputs(workspace_id, edit_id, file_id, role, position)
    VALUES (workspace_a, edit_a, original_file, 'base', 0),
           (workspace_a, edit_a, edited_file, 'attachment', 0);

    BEGIN
        INSERT INTO app.file_objects(workspace_id, storage_provider, bucket, object_key,
                                     media_type, source_kind, source_file_id, edit_id)
        VALUES (workspace_a, 'cos', 'test', gen_random_uuid()::text,
                'image', 'edited', original_file, edit_b);
        RAISE EXCEPTION '跨空间编辑来源未被拒绝';
    EXCEPTION WHEN foreign_key_violation THEN NULL; END;

    BEGIN
        INSERT INTO app.content_edit_inputs(workspace_id, edit_id, file_id, role, position)
        VALUES (workspace_a, edit_a, other_file, 'reference', 0);
        RAISE EXCEPTION '跨空间编辑输入未被拒绝';
    EXCEPTION WHEN foreign_key_violation THEN NULL; END;

    BEGIN
        INSERT INTO app.content_edit_inputs(workspace_id, edit_id, file_id, role, position)
        VALUES (workspace_a, edit_a, edited_file, 'base', 0);
        RAISE EXCEPTION '重复编辑输入位置未被拒绝';
    EXCEPTION WHEN unique_violation THEN NULL; END;

    INSERT INTO app.assets(workspace_id, asset_type, title)
    VALUES (workspace_a, 'image', 'Node asset A') RETURNING id INTO asset_a;
    INSERT INTO app.asset_versions(asset_id, workspace_id, version_no)
    VALUES (asset_a, workspace_a, 1) RETURNING id INTO version_a;
    INSERT INTO app.asset_files(asset_version_id, file_id, workspace_id, role)
    VALUES (version_a, original_file, workspace_a, 'source');
    INSERT INTO app.assets(workspace_id, asset_type, title)
    VALUES (workspace_b, 'image', 'Node asset B') RETURNING id INTO asset_b;
    INSERT INTO app.asset_versions(asset_id, workspace_id, version_no)
    VALUES (asset_b, workspace_b, 1) RETURNING id INTO version_b;

    INSERT INTO app.canvas_projects(workspace_id, external_key, title)
    VALUES (workspace_a, 'file-job-project-' || gen_random_uuid(), 'File job project') RETURNING id INTO project_a;
    INSERT INTO app.canvas_nodes(project_id, workspace_id, node_key, node_type, title, position, width, height)
    VALUES (project_a, workspace_a, 'node-a', 'image', 'Image node', '{"x":0,"y":0}', 320, 240)
    RETURNING id INTO node_a;
    INSERT INTO app.canvas_node_asset_uses(workspace_id, project_id, node_id, slot_key,
                                           asset_id, asset_version_id, file_id, file_role, created_by)
    VALUES (workspace_a, project_a, node_a, 'primary', asset_a, version_a, original_file, 'source', user_a);

    BEGIN
        INSERT INTO app.canvas_node_asset_uses(workspace_id, project_id, node_id, slot_key,
                                               asset_id, asset_version_id, file_id, file_role)
        VALUES (workspace_a, project_a, node_a, 'wrong-version', asset_a, version_b, original_file, 'source');
        RAISE EXCEPTION '资产与版本不匹配的节点引用未被拒绝';
    EXCEPTION WHEN foreign_key_violation THEN NULL; END;

    BEGIN
        INSERT INTO app.canvas_node_asset_uses(workspace_id, project_id, node_id, slot_key,
                                               asset_id, asset_version_id, file_id, file_role)
        VALUES (workspace_a, project_a, node_a, 'wrong-file', asset_a, version_a, other_file, 'source');
        RAISE EXCEPTION '不属于所选版本的文件未被拒绝';
    EXCEPTION WHEN foreign_key_violation THEN NULL; END;

    INSERT INTO app.upload_sessions(workspace_id, file_id, attempt_no, expires_at)
    VALUES (workspace_a, original_file, 1, now() + interval '1 hour') RETURNING id INTO session_a;
    INSERT INTO app.upload_sessions(workspace_id, file_id, attempt_no, expires_at)
    VALUES (workspace_b, other_file, 1, now() + interval '1 hour') RETURNING id INTO session_b;

    INSERT INTO app.generation_tasks(workspace_id, task_type, status, request_id, idempotency_key)
    VALUES (workspace_a, 'image', 'pending', 'node-use-' || gen_random_uuid(), 'node-use-' || gen_random_uuid())
    RETURNING id INTO task_a;
    INSERT INTO app.generation_attempts(workspace_id, task_id, attempt_no, provider)
    VALUES (workspace_a, task_a, 1, 'file-job-test') RETURNING id INTO attempt_a;
    INSERT INTO app.generation_outputs(task_id, workspace_id, attempt_id, output_index,
                                       provider_output_id, availability, output_type, file_id)
    VALUES (task_a, workspace_a, attempt_a, 0, 'file-job-output-' || gen_random_uuid(),
            'available', 'image', edited_file) RETURNING id INTO output_a;
    INSERT INTO app.generation_tasks(workspace_id, task_type, status, request_id, idempotency_key)
    VALUES (workspace_b, 'image', 'pending', 'node-use-' || gen_random_uuid(), 'node-use-' || gen_random_uuid())
    RETURNING id INTO task_b;
    INSERT INTO app.generation_attempts(workspace_id, task_id, attempt_no, provider)
    VALUES (workspace_b, task_b, 1, 'file-job-test') RETURNING id INTO attempt_b;
    INSERT INTO app.generation_outputs(task_id, workspace_id, attempt_id, output_index,
                                       provider_output_id, availability, output_type, file_id)
    VALUES (task_b, workspace_b, attempt_b, 0, 'file-job-output-' || gen_random_uuid(),
            'available', 'image', other_file) RETURNING id INTO output_b;

    job_key := 'persist-' || gen_random_uuid();
    INSERT INTO app.file_jobs(workspace_id, file_id, job_kind, idempotency_key, upload_session_id)
    VALUES (workspace_a, original_file, 'persist', job_key, session_a)
    RETURNING id INTO job_a;
    INSERT INTO app.file_jobs(workspace_id, file_id, job_kind, idempotency_key, generation_output_id)
    VALUES (workspace_a, edited_file, 'verify', 'verify-' || gen_random_uuid(), output_a);
    INSERT INTO app.file_jobs(workspace_id, file_id, job_kind, idempotency_key)
    VALUES (workspace_b, other_file, 'delete', 'delete-' || gen_random_uuid()) RETURNING id INTO job_b;

    BEGIN
        INSERT INTO app.file_jobs(workspace_id, file_id, job_kind, idempotency_key, upload_session_id)
        VALUES (workspace_a, original_file, 'persist', job_key, session_a);
        RAISE EXCEPTION '重复文件作业幂等键未被拒绝';
    EXCEPTION WHEN unique_violation THEN NULL; END;

    BEGIN
        INSERT INTO app.file_jobs(workspace_id, file_id, job_kind, idempotency_key, upload_session_id)
        VALUES (workspace_a, original_file, 'persist', 'bad-session-' || gen_random_uuid(), session_b);
        RAISE EXCEPTION '跨空间上传会话文件作业未被拒绝';
    EXCEPTION WHEN foreign_key_violation THEN NULL; END;

    BEGIN
        INSERT INTO app.file_jobs(workspace_id, file_id, job_kind, idempotency_key, generation_output_id)
        VALUES (workspace_a, edited_file, 'verify', 'bad-output-' || gen_random_uuid(),
                output_b);
        RAISE EXCEPTION '跨空间输出文件作业未被拒绝';
    EXCEPTION WHEN foreign_key_violation THEN NULL; END;

    BEGIN
        INSERT INTO app.file_jobs(workspace_id, file_id, job_kind, idempotency_key)
        VALUES (workspace_a, original_file, 'persist', 'missing-input-' || gen_random_uuid());
        RAISE EXCEPTION '没有明确输入关系的持久化作业未被拒绝';
    EXCEPTION WHEN check_violation THEN NULL; END;

    UPDATE app.file_jobs
       SET status = 'running', attempt_count = 1, lease_version = 1,
           lease_owner = 'worker-a', lease_until = clock_timestamp() + interval '50 milliseconds'
     WHERE id = job_a;
    PERFORM pg_sleep(0.08);
    UPDATE app.file_jobs
       SET attempt_count = 2, lease_version = 2, lease_owner = 'worker-b',
           lease_until = clock_timestamp() + interval '5 minutes'
     WHERE id = job_a;
    PERFORM set_config('app.file_job_lease_owner', 'worker-a', true);
    PERFORM set_config('app.file_job_lease_version', '1', true);
    BEGIN
        UPDATE app.file_jobs SET status = 'succeeded', lease_owner = NULL, lease_until = NULL
        WHERE id = job_a;
        RAISE EXCEPTION '旧执行器提交未被租约版本拦截';
    EXCEPTION WHEN check_violation THEN NULL; END;
    PERFORM set_config('app.file_job_lease_owner', 'worker-b', true);
    PERFORM set_config('app.file_job_lease_version', '2', true);
    UPDATE app.file_jobs SET status = 'succeeded', lease_owner = NULL, lease_until = NULL
    WHERE id = job_a;
    BEGIN
        UPDATE app.file_jobs SET status = 'running', attempt_count = 3, lease_version = 3,
                                 lease_owner = 'worker-c', lease_until = now() + interval '1 minute'
        WHERE id = job_a;
        RAISE EXCEPTION '已完成作业被重新领取';
    EXCEPTION WHEN check_violation THEN NULL; END;

    PERFORM set_config('test.file_job_user_a', user_a::text, true);
    PERFORM set_config('test.file_job_edit_a', edit_a::text, true);
    PERFORM set_config('test.file_job_job_a', job_a::text, true);
    PERFORM set_config('test.file_job_edit_b', edit_b::text, true);
    PERFORM set_config('test.file_job_job_b', job_b::text, true);
    PERFORM set_config('test.file_job_attempt', '2', true);
    INSERT INTO app.file_jobs(workspace_id, file_id, job_kind, idempotency_key, upload_session_id)
    VALUES (workspace_a, original_file, 'persist', 'recover-' || gen_random_uuid(), session_a)
    RETURNING id INTO recovery_job;
    INSERT INTO app.file_jobs(workspace_id, file_id, job_kind, idempotency_key, upload_session_id)
    VALUES (workspace_a, original_file, 'persist', 'retry-' || gen_random_uuid(), session_a)
    RETURNING id INTO retry_job;
    INSERT INTO app.file_jobs(workspace_id, file_id, job_kind, idempotency_key, upload_session_id)
    VALUES (workspace_a, original_file, 'persist', 'cancel-' || gen_random_uuid(), session_a)
    RETURNING id INTO cancel_job;
    PERFORM set_config('test.file_job_recovery', recovery_job::text, true);
    PERFORM set_config('test.file_job_retry', retry_job::text, true);
    PERFORM set_config('test.file_job_cancel', cancel_job::text, true);
    RAISE NOTICE 'PASS: 编辑来源、节点固定文件版本、文件作业输入和租约防旧执行器';
END $$;

SET LOCAL ROLE qingyu_app;
SELECT set_config('app.user_id', current_setting('test.file_job_user_a'), true);
DO $$
DECLARE
    claimed record;
    retry_status text;
BEGIN
    SELECT * INTO claimed FROM app.claim_file_upload_recovery_jobs('sql-test-worker', 1);
    IF NOT FOUND OR claimed.id <> current_setting('test.file_job_recovery')::uuid
       OR claimed.lease_version <> 1 OR claimed.attempt_count <> 1 THEN
        RAISE EXCEPTION '恢复 worker 未正确领取并递增租约';
    END IF;
    IF NOT app.finish_file_job(claimed.id, 'sql-test-worker', claimed.lease_version) THEN
        RAISE EXCEPTION '当前租约不能完成文件作业';
    END IF;

    SELECT * INTO claimed FROM app.claim_file_upload_recovery_jobs('sql-test-worker', 1);
    IF NOT FOUND OR claimed.id <> current_setting('test.file_job_retry')::uuid THEN
        RAISE EXCEPTION '第二个恢复作业未被领取';
    END IF;
    SELECT status INTO retry_status FROM app.retry_file_job(claimed.id, 'sql-test-worker', claimed.lease_version, 'temporary_error', 1);
    IF NOT FOUND OR retry_status <> 'needs_attention' THEN
        RAISE EXCEPTION '重试达到上限后未进入人工处理';
    END IF;

    SELECT * INTO claimed FROM app.claim_file_upload_recovery_jobs('sql-test-worker', 1);
    IF NOT FOUND OR claimed.id <> current_setting('test.file_job_cancel')::uuid THEN
        RAISE EXCEPTION '第三个恢复作业未被领取';
    END IF;
    IF NOT app.cancel_file_job(claimed.id, 'sql-test-worker', claimed.lease_version) THEN
        RAISE EXCEPTION '当前租约不能取消文件作业';
    END IF;
END $$;
DO $$
BEGIN
    IF (SELECT count(*) FROM app.content_edits WHERE id = current_setting('test.file_job_edit_a')::uuid) <> 1
       OR (SELECT count(*) FROM app.content_edits WHERE id = current_setting('test.file_job_edit_b')::uuid) <> 0 THEN
        RAISE EXCEPTION '编辑记录行级安全过滤错误';
    END IF;
    IF (SELECT count(*) FROM app.file_jobs WHERE id = current_setting('test.file_job_job_a')::uuid) <> 1
       OR (SELECT count(*) FROM app.file_jobs WHERE id = current_setting('test.file_job_job_b')::uuid) <> 0 THEN
        RAISE EXCEPTION '文件作业行级安全过滤错误';
    END IF;
END $$;
RESET ROLE;
ROLLBACK;
