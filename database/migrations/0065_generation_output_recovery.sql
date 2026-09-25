-- 生图返回结果后，先保留输出槽位，再由可租约作业补齐 COS 与数据库之间的失败。
BEGIN;
SELECT pg_advisory_xact_lock(70420260965);

ALTER TABLE app.generation_tasks
    DROP CONSTRAINT IF EXISTS generation_tasks_status_check;
ALTER TABLE app.generation_tasks
    ADD CONSTRAINT generation_tasks_status_check
        CHECK (status IN ('pending','running','saving','succeeded','failed','refunded'));

ALTER TABLE app.generation_outputs
    ADD COLUMN recovery_source_ciphertext text,
    ADD CONSTRAINT generation_outputs_recovery_ciphertext_size_check
        CHECK (recovery_source_ciphertext IS NULL OR length(recovery_source_ciphertext) <= 32768);

CREATE INDEX generation_outputs_recovery_pending_idx
    ON app.generation_outputs(attempt_id, output_index)
    WHERE attempt_id IS NOT NULL AND availability = 'awaiting';

CREATE OR REPLACE FUNCTION app.mark_generation_task_saving(p_task_id uuid)
RETURNS app.generation_tasks
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE t app.generation_tasks%ROWTYPE;
BEGIN
    SELECT * INTO t FROM app.generation_tasks WHERE id=p_task_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION '任务不存在'; END IF;
    IF NOT app.has_workspace_access(t.workspace_id) THEN RAISE EXCEPTION '无权访问工作空间'; END IF;
    IF t.status = 'saving' THEN RETURN t; END IF;
    IF t.status NOT IN ('running','pending') THEN RAISE EXCEPTION '任务不能进入保存恢复状态: %', t.status; END IF;
    UPDATE app.generation_tasks
       SET status='saving', error_code='output_persist_pending',
           error_message='生成已完成，正在恢复保存', updated_at=now()
     WHERE id=t.id RETURNING * INTO t;
    RETURN t;
END;
$$;

CREATE OR REPLACE FUNCTION app.settle_generation_task_success(p_task_id uuid, p_outputs jsonb, p_provider_ref text)
RETURNS app.generation_tasks
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE t app.generation_tasks%ROWTYPE;
BEGIN
    SELECT * INTO t FROM app.generation_tasks WHERE id=p_task_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION '任务不存在'; END IF;
    IF NOT app.has_workspace_access(t.workspace_id) THEN RAISE EXCEPTION '无权访问工作空间'; END IF;
    IF t.status='succeeded' THEN RETURN t; END IF;
    IF t.status NOT IN ('running','saving','pending') THEN RAISE EXCEPTION '任务已结束，不能再结算: %', t.status; END IF;

    IF t.quota_reservation_id IS NOT NULL THEN
        PERFORM app.settle_quota(t.quota_reservation_id, t.id::text||':commit');
    ELSIF t.daily_reservation_id IS NOT NULL THEN
        PERFORM app.settle_free_daily_usage(t.daily_reservation_id, t.id::text||':commit');
    END IF;
    IF t.usage_record_id IS NOT NULL THEN
        UPDATE app.usage_records SET result='committed',
            metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('phase','finished','provider_ref',p_provider_ref)
         WHERE id=t.usage_record_id;
    END IF;
    UPDATE app.generation_tasks SET status='succeeded', finished_at=now(),
        outputs=COALESCE(p_outputs,outputs), error_code=NULL, error_message=NULL, updated_at=now()
     WHERE id=t.id RETURNING * INTO t;
    RETURN t;
END;
$$;

CREATE OR REPLACE FUNCTION app.fail_generation_task(
    p_task_id uuid, p_error_code text, p_error_message text, p_refund boolean
) RETURNS app.generation_tasks
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE t app.generation_tasks%ROWTYPE; saved_outputs jsonb;
BEGIN
    SELECT * INTO t FROM app.generation_tasks WHERE id=p_task_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION '任务不存在'; END IF;
    IF NOT app.has_workspace_access(t.workspace_id) THEN RAISE EXCEPTION '无权访问工作空间'; END IF;
    IF t.status IN ('succeeded','refunded') THEN RETURN t; END IF;

    UPDATE app.generation_outputs SET availability='unavailable',recovery_source_ciphertext=NULL
     WHERE task_id=t.id AND workspace_id=t.workspace_id AND availability='awaiting';
    UPDATE app.file_objects f SET status='failed',last_error_code='generation_task_failed',updated_at=now()
      FROM app.generation_outputs o
     WHERE o.task_id=t.id AND o.workspace_id=t.workspace_id AND o.file_id=f.id
       AND f.workspace_id=t.workspace_id AND f.status='pending' AND o.availability='unavailable';
    UPDATE app.file_jobs j SET status='cancelled',last_error_code='generation_task_failed'
     WHERE j.generation_output_id IN (SELECT id FROM app.generation_outputs WHERE task_id=t.id AND workspace_id=t.workspace_id)
       AND j.status IN ('queued','retry_wait');

    SELECT coalesce(jsonb_agg(jsonb_build_object('type','image','index',o.output_index,'fileId',f.id,
        'objectKey',f.object_key,'revisedPrompt',o.metadata->>'revisedPrompt') ORDER BY o.output_index),'[]'::jsonb)
      INTO saved_outputs
      FROM app.generation_outputs o JOIN app.file_objects f
        ON f.id=o.file_id AND f.workspace_id=o.workspace_id AND f.status='ready'
     WHERE o.task_id=t.id AND o.workspace_id=t.workspace_id
       AND o.output_type='image' AND o.availability='available';

    IF p_refund THEN
        IF t.quota_reservation_id IS NOT NULL THEN
            PERFORM app.release_quota(t.quota_reservation_id,t.id::text||':release');
        ELSIF t.daily_reservation_id IS NOT NULL THEN
            PERFORM app.release_free_daily_usage(t.daily_reservation_id,t.id::text||':release');
        END IF;
    END IF;
    IF t.usage_record_id IS NOT NULL THEN
        UPDATE app.usage_records SET result=CASE WHEN p_refund THEN 'released' ELSE 'failed' END,
          metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('phase','finished','error',p_error_code)
         WHERE id=t.usage_record_id;
    END IF;
    UPDATE app.generation_tasks SET status=CASE WHEN p_refund THEN 'refunded' ELSE 'failed' END,
        finished_at=now(),error_code=LEFT(COALESCE(p_error_code,'unknown'),120),
        error_message=LEFT(COALESCE(p_error_message,''),2000),
        outputs=CASE WHEN saved_outputs <> '[]'::jsonb THEN saved_outputs ELSE COALESCE(outputs,'[]'::jsonb) END,
        updated_at=now()
     WHERE id=t.id RETURNING * INTO t;
    RETURN t;
END;
$$;

CREATE OR REPLACE FUNCTION app.reap_stale_generation_output_tasks()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE t record; n integer := 0;
BEGIN
    FOR t IN
        SELECT id,created_by,workspace_id FROM app.generation_tasks
         WHERE status='saving' AND timeout_at IS NOT NULL AND timeout_at < now()
         FOR UPDATE SKIP LOCKED
    LOOP
        IF t.created_by IS NULL THEN
            INSERT INTO app.platform_alerts(alert_type,severity,workspace_id,summary,detail)
            VALUES('generation_output_missing_actor','critical',t.workspace_id,
              '图片恢复超时且缺少任务创建人，暂未自动退还额度',jsonb_build_object('task_id',t.id));
            CONTINUE;
        END IF;
        PERFORM set_config('app.user_id',t.created_by::text,true);
        UPDATE app.generation_outputs SET availability='unavailable',recovery_source_ciphertext=NULL
         WHERE task_id=t.id AND workspace_id=t.workspace_id AND availability='awaiting';
        UPDATE app.file_objects f SET status='failed',last_error_code='recovery_timeout',updated_at=now()
          FROM app.generation_outputs o
         WHERE o.task_id=t.id AND o.workspace_id=t.workspace_id AND o.file_id=f.id
           AND f.workspace_id=t.workspace_id AND f.status='pending' AND o.availability='unavailable';
        UPDATE app.file_jobs j SET status='cancelled',last_error_code='task_recovery_timeout'
         WHERE j.generation_output_id IN (SELECT id FROM app.generation_outputs WHERE task_id=t.id AND workspace_id=t.workspace_id)
           AND j.status IN ('queued','retry_wait');
        UPDATE app.generation_tasks gt SET outputs=(
            SELECT coalesce(jsonb_agg(jsonb_build_object('type','image','index',o.output_index,'fileId',f.id,
                'objectKey',f.object_key,'revisedPrompt',o.metadata->>'revisedPrompt') order by o.output_index),'[]'::jsonb)
              FROM app.generation_outputs o JOIN app.file_objects f
                ON f.id=o.file_id AND f.workspace_id=o.workspace_id AND f.status='ready'
             WHERE o.task_id=t.id AND o.workspace_id=t.workspace_id
               AND o.output_type='image' AND o.availability='available')
         WHERE gt.id=t.id AND gt.workspace_id=t.workspace_id;
        PERFORM app.fail_generation_task(t.id,'output_recovery_timeout','图片保存恢复超时，本次预扣额度已退回',true);
        n := n + 1;
    END LOOP;
    RETURN n;
END;
$$;

DROP FUNCTION app.claim_file_upload_recovery_jobs(text, integer);
CREATE FUNCTION app.claim_file_upload_recovery_jobs(p_worker text, p_limit integer DEFAULT 10)
RETURNS TABLE (
    id uuid, workspace_id uuid, file_id uuid, upload_session_id uuid,
    generation_output_id uuid, lease_version bigint, attempt_count integer, appwrite_user_id text
)
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, app AS $$
    WITH candidates AS (
        SELECT j.id
          FROM app.file_jobs j
          LEFT JOIN app.generation_outputs o
            ON o.id=j.generation_output_id AND o.workspace_id=j.workspace_id
          LEFT JOIN app.generation_attempts a
            ON a.id=o.attempt_id AND a.task_id=o.task_id AND a.workspace_id=o.workspace_id
          LEFT JOIN app.generation_tasks t
            ON t.id=o.task_id AND t.workspace_id=o.workspace_id
         WHERE j.job_kind='persist'
           AND (j.upload_session_id IS NOT NULL
                OR (j.generation_output_id IS NOT NULL AND a.response_complete=true AND (
                    (t.status='saving' AND o.availability='awaiting')
                    OR (t.status IN ('failed','refunded','succeeded') AND o.availability IN ('available','unavailable')))))
           AND ((j.status IN ('queued','retry_wait') AND j.next_run_at <= now())
             OR (j.status='running' AND j.lease_until <= clock_timestamp()))
         ORDER BY j.next_run_at, j.created_at
         FOR UPDATE OF j SKIP LOCKED
         LIMIT LEAST(50, GREATEST(1, COALESCE(p_limit,10)))
    ), claimed AS (
        UPDATE app.file_jobs j
           SET status='running', attempt_count=j.attempt_count+1,
               lease_version=j.lease_version+1, lease_owner=left(btrim(p_worker),200),
               lease_until=clock_timestamp()+interval '2 minutes'
          FROM candidates c
         WHERE j.id=c.id AND length(btrim(p_worker))>0
        RETURNING j.id,j.workspace_id,j.file_id,j.upload_session_id,j.generation_output_id,
                  j.lease_version,j.attempt_count
    )
    SELECT c.id,c.workspace_id,c.file_id,c.upload_session_id,c.generation_output_id,
           c.lease_version,c.attempt_count,u.appwrite_user_id
      FROM claimed c
      JOIN app.workspaces w ON w.id=c.workspace_id
      LEFT JOIN app.generation_outputs o
        ON o.id=c.generation_output_id AND o.workspace_id=c.workspace_id
      LEFT JOIN app.generation_tasks t
        ON t.id=o.task_id AND t.workspace_id=o.workspace_id
      JOIN app.user_accounts u ON u.id=COALESCE(t.created_by,w.owner_user_id)
     WHERE u.status='active' AND w.status='active' AND length(btrim(p_worker))>0;
$$;

REVOKE ALL ON FUNCTION app.mark_generation_task_saving(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.mark_generation_task_saving(uuid) TO qingyu_app;
REVOKE ALL ON FUNCTION app.reap_stale_generation_output_tasks() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.reap_stale_generation_output_tasks() TO qingyu_app;
REVOKE ALL ON FUNCTION app.claim_file_upload_recovery_jobs(text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.claim_file_upload_recovery_jobs(text,integer) TO qingyu_app;

INSERT INTO app.schema_migrations(version, checksum)
VALUES ('0065_generation_output_recovery', 'generation-output-recovery-v1')
ON CONFLICT (version) DO NOTHING;
COMMIT;
