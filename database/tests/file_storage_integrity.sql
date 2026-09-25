\set ON_ERROR_STOP on
BEGIN;
DO $$
DECLARE
    user_a uuid;
    workspace_a uuid;
    workspace_b uuid;
    project_a uuid;
    project_second uuid;
    asset_a uuid;
    version_a uuid;
    file_a uuid;
    file_b uuid;
    file_other uuid;
    derived_file uuid;
    batch_a uuid;
    batch_other uuid;
    task_a uuid;
    asset_other uuid;
    version_other uuid;
    asset_wrong_version uuid;
    version_wrong_version uuid;
BEGIN
    INSERT INTO app.user_accounts(appwrite_user_id)
    VALUES ('storage-test-' || gen_random_uuid()) RETURNING id INTO user_a;
    INSERT INTO app.workspaces(type, owner_user_id, name)
    VALUES ('personal', user_a, 'Storage test A') RETURNING id INTO workspace_a;
    INSERT INTO app.user_accounts(appwrite_user_id)
    VALUES ('storage-test-' || gen_random_uuid()) RETURNING id INTO user_a;
    INSERT INTO app.workspaces(type, owner_user_id, name)
    VALUES ('personal', user_a, 'Storage test B') RETURNING id INTO workspace_b;

    -- 历史记录允许待核实分类为空；新增上传来源需要同空间批次。
    INSERT INTO app.file_objects(workspace_id, storage_provider, bucket, object_key)
    VALUES (workspace_a, 'cos', 'test', gen_random_uuid()::text) RETURNING id INTO file_a;
    INSERT INTO app.file_objects(workspace_id, storage_provider, bucket, object_key)
    VALUES (workspace_b, 'cos', 'test', gen_random_uuid()::text) RETURNING id INTO file_other;
    INSERT INTO app.upload_batches(workspace_id, idempotency_key)
    VALUES (workspace_a, 'batch-' || gen_random_uuid()) RETURNING id INTO batch_a;
    INSERT INTO app.upload_batches(workspace_id, idempotency_key)
    VALUES (workspace_b, 'batch-' || gen_random_uuid()) RETURNING id INTO batch_other;
    INSERT INTO app.file_objects(workspace_id, storage_provider, bucket, object_key,
                                  media_type, source_kind, upload_batch_id,
                                  original_filename, write_idempotency_key)
    VALUES (workspace_a, 'cos', 'test', gen_random_uuid()::text, 'image', 'reference_upload',
            batch_a, 'ref.png', 'file-' || gen_random_uuid()) RETURNING id INTO file_b;
    INSERT INTO app.file_objects(workspace_id, storage_provider, bucket, object_key,
                                  media_type, source_kind, source_file_id, preview_variant)
    VALUES (workspace_a, 'cos', 'test', gen_random_uuid()::text, 'image', 'derived', file_a, 'small')
    RETURNING id INTO derived_file;

    BEGIN
        UPDATE app.file_objects SET source_kind = 'edited', source_file_id = derived_file
        WHERE id = file_a;
        RAISE EXCEPTION '文件来源循环未被拒绝' USING ERRCODE = '23514';
    EXCEPTION WHEN check_violation THEN NULL; END;

    INSERT INTO app.generation_tasks(workspace_id, task_type, status, request_id, idempotency_key)
    VALUES (workspace_a, 'image', 'pending', 'req-' || gen_random_uuid(), 'task-' || gen_random_uuid()) RETURNING id INTO task_a;
    INSERT INTO app.generation_inputs(workspace_id, task_id, file_id, role, position)
    VALUES (workspace_a, task_a, file_b, 'reference', 0);

    INSERT INTO app.assets(workspace_id, asset_type, title)
    VALUES (workspace_a, 'image', 'Storage test asset') RETURNING id INTO asset_a;
    INSERT INTO app.asset_versions(asset_id, workspace_id, version_no)
    VALUES (asset_a, workspace_a, 1) RETURNING id INTO version_a;
    INSERT INTO app.assets(workspace_id, asset_type, title)
    VALUES (workspace_b, 'image', 'Other workspace asset') RETURNING id INTO asset_other;
    INSERT INTO app.asset_versions(asset_id, workspace_id, version_no)
    VALUES (asset_other, workspace_b, 1) RETURNING id INTO version_other;
    INSERT INTO app.assets(workspace_id, asset_type, title)
    VALUES (workspace_a, 'image', 'Wrong version asset') RETURNING id INTO asset_wrong_version;
    INSERT INTO app.asset_versions(asset_id, workspace_id, version_no)
    VALUES (asset_wrong_version, workspace_a, 1) RETURNING id INTO version_wrong_version;
    INSERT INTO app.canvas_projects(workspace_id, external_key, title)
    VALUES (workspace_a, 'project-' || gen_random_uuid(), 'Storage test project') RETURNING id INTO project_a;
    INSERT INTO app.canvas_projects(workspace_id, external_key, title)
    VALUES (workspace_a, 'project-' || gen_random_uuid(), 'Storage test project 2') RETURNING id INTO project_second;
    INSERT INTO app.canvas_project_assets(workspace_id, project_id, asset_id, asset_version_id)
    VALUES (workspace_a, project_a, asset_a, version_a);

    BEGIN
        INSERT INTO app.file_objects(workspace_id, storage_provider, bucket, object_key,
                                     media_type, source_kind, upload_batch_id)
        VALUES (workspace_a, 'cos', 'test', gen_random_uuid()::text, 'image', 'manual_upload',
                batch_other);
        RAISE EXCEPTION '跨空间上传批次未被拒绝';
    EXCEPTION WHEN foreign_key_violation THEN NULL; END;

    BEGIN
        INSERT INTO app.file_objects(workspace_id, storage_provider, bucket, object_key,
                                     media_type, source_kind, upload_batch_id)
        VALUES (workspace_a, 'cos', 'test', gen_random_uuid()::text, 'video', 'manual_upload', NULL);
        RAISE EXCEPTION '缺少上传批次未被拒绝';
    EXCEPTION WHEN check_violation THEN NULL; END;

    BEGIN
        INSERT INTO app.generation_inputs(workspace_id, task_id, file_id, role, position)
        VALUES (workspace_a, task_a, file_a, 'reference', 0);
        RAISE EXCEPTION '重复输入位置未被拒绝';
    EXCEPTION WHEN unique_violation THEN NULL; END;

    BEGIN
        INSERT INTO app.generation_inputs(workspace_id, task_id, file_id, role, position)
        VALUES (workspace_a, task_a, file_other, 'attachment', 0);
        RAISE EXCEPTION '跨空间任务输入未被拒绝';
    EXCEPTION WHEN foreign_key_violation THEN NULL; END;

    BEGIN
        INSERT INTO app.canvas_project_assets(workspace_id, project_id, asset_id, asset_version_id)
        VALUES (workspace_a, project_a, asset_other, version_other);
        RAISE EXCEPTION '跨空间项目素材未被拒绝';
    EXCEPTION WHEN foreign_key_violation THEN NULL; END;

    BEGIN
        INSERT INTO app.canvas_project_assets(workspace_id, project_id, asset_id, asset_version_id)
        VALUES (workspace_a, project_second, asset_a, version_wrong_version);
        RAISE EXCEPTION '不属于当前资产的项目版本未被拒绝';
    EXCEPTION WHEN foreign_key_violation THEN NULL; END;

    BEGIN
        INSERT INTO app.file_objects(workspace_id, storage_provider, bucket, object_key,
                                     media_type, source_kind, upload_batch_id,
                                     write_idempotency_key)
        VALUES (workspace_a, 'cos', 'test', gen_random_uuid()::text, 'image', 'manual_upload',
                batch_a, (SELECT write_idempotency_key FROM app.file_objects WHERE id = file_b));
        RAISE EXCEPTION '重复文件写入幂等键未被拒绝';
    EXCEPTION WHEN unique_violation THEN NULL; END;

    RAISE NOTICE 'PASS: 文件分类与历史兼容、上传批次隔离、生成输入关系、项目固定版本、写入幂等约束';
END $$;
ROLLBACK;
