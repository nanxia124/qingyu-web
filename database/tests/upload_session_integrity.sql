\set ON_ERROR_STOP on
BEGIN;
DO $$
DECLARE
    user_id uuid;
    workspace_a uuid;
    workspace_b uuid;
    file_a uuid;
    file_b uuid;
    session_a uuid;
BEGIN
    INSERT INTO app.user_accounts(appwrite_user_id)
    VALUES ('upload-session-test-' || gen_random_uuid()) RETURNING id INTO user_id;
    INSERT INTO app.workspaces(type, owner_user_id, name)
    VALUES ('personal', user_id, 'Upload session A') RETURNING id INTO workspace_a;
    INSERT INTO app.user_accounts(appwrite_user_id)
    VALUES ('upload-session-test-' || gen_random_uuid()) RETURNING id INTO user_id;
    INSERT INTO app.workspaces(type, owner_user_id, name)
    VALUES ('personal', user_id, 'Upload session B') RETURNING id INTO workspace_b;

    INSERT INTO app.file_objects(workspace_id, storage_provider, bucket, object_key,
                                 media_type, source_kind, completeness)
    VALUES (workspace_a, 'cos', 'test', gen_random_uuid()::text, 'text', 'generated', 'partial')
    RETURNING id INTO file_a;
    INSERT INTO app.file_objects(workspace_id, storage_provider, bucket, object_key,
                                 media_type, source_kind)
    VALUES (workspace_b, 'cos', 'test', gen_random_uuid()::text, 'image', 'generated')
    RETURNING id INTO file_b;

    BEGIN
        INSERT INTO app.file_objects(workspace_id, storage_provider, bucket, object_key,
                                     media_type, source_kind, completeness)
        VALUES (workspace_a, 'cos', 'test', gen_random_uuid()::text, 'image', 'generated', 'partial');
        RAISE EXCEPTION '非文字文件被允许设置文字完成度';
    EXCEPTION WHEN check_violation THEN NULL; END;
    BEGIN
        INSERT INTO app.file_objects(workspace_id, storage_provider, bucket, object_key,
                                     media_type, source_kind)
        VALUES (workspace_a, 'cos', 'test', gen_random_uuid()::text, 'text', 'generated');
        RAISE EXCEPTION '文字文件缺少完成度仍被允许';
    EXCEPTION WHEN check_violation THEN NULL; END;

    INSERT INTO app.upload_sessions(workspace_id, file_id, attempt_no, provider_upload_id, expires_at)
    VALUES (workspace_a, file_a, 1, 'cos-upload-1', now() + interval '1 hour')
    RETURNING id INTO session_a;

    BEGIN
        INSERT INTO app.upload_sessions(workspace_id, file_id, attempt_no, expires_at)
        VALUES (workspace_a, file_b, 1, now() + interval '1 hour');
        RAISE EXCEPTION '跨空间文件上传会话未被拒绝';
    EXCEPTION WHEN foreign_key_violation THEN NULL; END;

    BEGIN
        INSERT INTO app.upload_sessions(workspace_id, file_id, attempt_no, expires_at)
        VALUES (workspace_a, file_a, 2, now() + interval '1 hour');
        RAISE EXCEPTION '同一文件的第二个活动会话未被拒绝';
    EXCEPTION WHEN unique_violation THEN NULL; END;

    BEGIN
        INSERT INTO app.upload_session_parts(session_id, workspace_id, part_number, etag, size_bytes)
        VALUES (session_a, workspace_a, 1, 'etag-1', 64);
        RAISE EXCEPTION '非上传中会话被允许登记分片';
    EXCEPTION WHEN check_violation THEN NULL; END;

    UPDATE app.upload_sessions SET status = 'uploading' WHERE id = session_a;
    INSERT INTO app.upload_session_parts(session_id, workspace_id, part_number, etag, size_bytes, checksum)
    VALUES (session_a, workspace_a, 1, 'etag-1', 64, 'sha256:test');
    BEGIN
        INSERT INTO app.upload_session_parts(session_id, workspace_id, part_number, etag, size_bytes)
        VALUES (session_a, workspace_a, 1, 'etag-duplicate', 64);
        RAISE EXCEPTION '重复分片编号未被拒绝';
    EXCEPTION WHEN unique_violation THEN NULL; END;

    UPDATE app.upload_sessions SET status = 'completing' WHERE id = session_a;
    BEGIN
        INSERT INTO app.upload_session_parts(session_id, workspace_id, part_number, etag, size_bytes)
        VALUES (session_a, workspace_a, 2, 'etag-2', 64);
        RAISE EXCEPTION '完成中的会话仍允许修改分片';
    EXCEPTION WHEN check_violation THEN NULL; END;

    UPDATE app.upload_sessions SET status = 'completed' WHERE id = session_a;
    IF (SELECT status FROM app.file_objects WHERE id = file_a) <> 'pending' THEN
        RAISE EXCEPTION '上传会话完成不应替代文件检查和 ready 状态';
    END IF;
    BEGIN
        UPDATE app.upload_sessions SET status = 'uploading' WHERE id = session_a;
        RAISE EXCEPTION '终态上传会话被允许重新打开';
    EXCEPTION WHEN check_violation THEN NULL; END;

    RAISE NOTICE 'PASS: 文件检查与文字完成度、空间隔离、单活动会话、分片锁定和终态规则';
END $$;
ROLLBACK;
