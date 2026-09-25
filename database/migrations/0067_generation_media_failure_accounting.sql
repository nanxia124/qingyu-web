-- Align async generation task quota classification with the existing AI proxy,
-- and allow confirmed video/audio generation failures to retain their charge.
BEGIN;
SELECT pg_advisory_xact_lock(70420260967);

CREATE OR REPLACE FUNCTION app.create_generation_task(
  p_workspace_id uuid, p_user_id uuid, p_task_type varchar,
  p_provider varchar, p_model varchar, p_pricing_version varchar,
  p_prompt text, p_parameters jsonb, p_quantity numeric,
  p_idempotency_key varchar, p_timeout_seconds integer
) RETURNS app.generation_tasks
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  t app.generation_tasks%ROWTYPE;
  v_reservation uuid := NULL;
  v_daily uuid := NULL;
  v_usage uuid;
  v_timeout timestamptz;
  v_quantity numeric;
  v_feature_code varchar(120);
BEGIN
  IF NOT app.has_workspace_access(p_workspace_id) THEN RAISE EXCEPTION '无权访问工作空间'; END IF;
  IF p_idempotency_key IS NULL OR length(btrim(p_idempotency_key)) = 0 THEN RAISE EXCEPTION '任务幂等键不能为空'; END IF;
  IF app.current_user_id() IS DISTINCT FROM p_user_id THEN RAISE EXCEPTION '任务创建人必须是当前登录用户'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('generation_task:' || p_idempotency_key, 70420260947));
  SELECT * INTO t FROM app.generation_tasks WHERE idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF t.workspace_id IS DISTINCT FROM p_workspace_id OR t.created_by IS DISTINCT FROM p_user_id THEN
      RAISE EXCEPTION '任务幂等键已属于其他工作空间或用户';
    END IF;
    RETURN t;
  END IF;

  v_quantity := GREATEST(1, COALESCE(p_quantity,1));
  v_timeout := now() + make_interval(secs => GREATEST(10, COALESCE(p_timeout_seconds,180)));
  v_feature_code := CASE WHEN p_task_type='image' THEN 'image_gen' ELSE 'ai_proxy' END;

  IF EXISTS (SELECT 1 FROM app.subscriptions s
             WHERE s.workspace_id=p_workspace_id AND s.status IN ('trialing','active','past_due')) THEN
    SELECT app.reserve_quota(p_workspace_id,'monthly',v_quantity,p_idempotency_key||':task',v_timeout)
      INTO v_reservation;
  ELSE
    SELECT app.reserve_free_daily_usage(p_workspace_id,p_user_id,v_feature_code,v_quantity,
                                        p_idempotency_key||':task',20,v_timeout)
      INTO v_daily;
  END IF;

  INSERT INTO app.usage_records(workspace_id,user_id,feature_code,provider,model,quantity,unit,result,
      idempotency_key,request_id,metadata,quota_reservation_id,daily_reservation_id)
    VALUES(p_workspace_id,p_user_id,v_feature_code,p_provider,p_model,v_quantity,'request','reserved',
      p_idempotency_key,p_idempotency_key,jsonb_build_object('task_type',p_task_type,'phase','created'),v_reservation,v_daily)
    RETURNING id INTO v_usage;

  INSERT INTO app.generation_tasks(workspace_id,created_by,task_type,provider,model,pricing_version,prompt,parameters,
      status,request_id,idempotency_key,timeout_at,quota_reservation_id,daily_reservation_id,usage_record_id)
    VALUES(p_workspace_id,p_user_id,COALESCE(p_task_type,'image'),p_provider,p_model,p_pricing_version,p_prompt,
      COALESCE(p_parameters,'{}'::jsonb),'pending',p_idempotency_key,p_idempotency_key,v_timeout,
      v_reservation,v_daily,v_usage)
    RETURNING * INTO t;
  RETURN t;
END;
$$;

CREATE OR REPLACE FUNCTION app.fail_generation_task_keep_charge(
    p_task_id uuid, p_error_code text, p_error_message text
) RETURNS app.generation_tasks
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE t app.generation_tasks%ROWTYPE; saved_outputs jsonb;
BEGIN
    SELECT * INTO t FROM app.generation_tasks WHERE id=p_task_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION '任务不存在'; END IF;
    IF NOT app.has_workspace_access(t.workspace_id) THEN RAISE EXCEPTION '无权访问工作空间'; END IF;
    IF t.status IN ('succeeded','failed','refunded') THEN RETURN t; END IF;
    IF t.task_type NOT IN ('video','audio') THEN RAISE EXCEPTION '只有视频或音频任务可以保留已完成生成的扣费'; END IF;
    IF t.status NOT IN ('pending','running','saving') THEN RAISE EXCEPTION '任务当前不能结算保存失败'; END IF;

    UPDATE app.generation_outputs SET availability='unavailable',recovery_source_ciphertext=NULL
     WHERE task_id=t.id AND workspace_id=t.workspace_id AND availability='awaiting';
    UPDATE app.file_objects f SET status='failed',last_error_code=LEFT(COALESCE(p_error_code,'output_unrecoverable'),120),updated_at=now()
      FROM app.generation_outputs o
     WHERE o.task_id=t.id AND o.workspace_id=t.workspace_id AND o.file_id=f.id
       AND f.workspace_id=t.workspace_id AND f.status='pending' AND o.availability='unavailable';
    UPDATE app.file_jobs j SET status='cancelled',last_error_code='generation_output_unrecoverable'
     WHERE j.generation_output_id IN (SELECT id FROM app.generation_outputs WHERE task_id=t.id AND workspace_id=t.workspace_id)
       AND j.status IN ('queued','retry_wait');

    SELECT coalesce(jsonb_agg(jsonb_build_object('type',o.output_type,'index',o.output_index,'fileId',f.id,
        'objectKey',f.object_key,'mimeType',f.mime_type,'sizeBytes',f.size_bytes,
        'width',o.width,'height',o.height,'durationMs',o.duration_ms) ORDER BY o.output_index),'[]'::jsonb)
      INTO saved_outputs
      FROM app.generation_outputs o JOIN app.file_objects f
        ON f.id=o.file_id AND f.workspace_id=o.workspace_id AND f.status='ready'
     WHERE o.task_id=t.id AND o.workspace_id=t.workspace_id AND o.availability='available';

    IF t.quota_reservation_id IS NOT NULL THEN
        PERFORM app.settle_quota(t.quota_reservation_id,t.id::text||':commit');
    ELSIF t.daily_reservation_id IS NOT NULL THEN
        PERFORM app.settle_free_daily_usage(t.daily_reservation_id,t.id::text||':commit');
    END IF;
    IF t.usage_record_id IS NOT NULL THEN
        UPDATE app.usage_records SET result='committed',completed_at=now(),
          metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
            'phase','finished','persistence_status','unrecoverable','error',LEFT(COALESCE(p_error_code,'output_unrecoverable'),120),
            'charge_policy','retained_after_provider_success')
         WHERE id=t.usage_record_id;
    END IF;
    UPDATE app.generation_tasks SET status='failed',finished_at=now(),
        error_code=LEFT(COALESCE(p_error_code,'output_unrecoverable'),120),
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
        SELECT id,created_by,workspace_id,task_type FROM app.generation_tasks
         WHERE status='saving' AND timeout_at IS NOT NULL AND timeout_at < now()
         FOR UPDATE SKIP LOCKED
    LOOP
        IF t.created_by IS NULL THEN
            INSERT INTO app.platform_alerts(alert_type,severity,workspace_id,summary,detail)
            VALUES('generation_output_missing_actor','critical',t.workspace_id,
              '生成结果恢复超时且缺少任务创建人，暂未自动结算',jsonb_build_object('task_id',t.id));
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
            SELECT coalesce(jsonb_agg(jsonb_build_object('type',o.output_type,'index',o.output_index,'fileId',f.id,
                'objectKey',f.object_key,'mimeType',f.mime_type,'sizeBytes',f.size_bytes,
                'width',o.width,'height',o.height,'durationMs',o.duration_ms) order by o.output_index),'[]'::jsonb)
              FROM app.generation_outputs o JOIN app.file_objects f
                ON f.id=o.file_id AND f.workspace_id=o.workspace_id AND f.status='ready'
             WHERE o.task_id=t.id AND o.workspace_id=t.workspace_id AND o.availability='available')
         WHERE gt.id=t.id AND gt.workspace_id=t.workspace_id;
        IF t.task_type IN ('video','audio') THEN
            PERFORM app.fail_generation_task_keep_charge(t.id,'output_recovery_timeout','视频或音频已生成，但保存恢复超时；本次扣点保留');
        ELSE
            PERFORM app.fail_generation_task(t.id,'output_recovery_timeout','图片保存恢复超时，本次预扣额度已退回',true);
        END IF;
        n := n + 1;
    END LOOP;
    RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION app.fail_generation_task_keep_charge(uuid,text,text) FROM PUBLIC, qingyu_app;
GRANT EXECUTE ON FUNCTION app.fail_generation_task_keep_charge(uuid,text,text) TO qingyu_api;
REVOKE ALL ON FUNCTION app.create_generation_task(uuid,uuid,varchar,varchar,varchar,varchar,text,jsonb,numeric,varchar,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.create_generation_task(uuid,uuid,varchar,varchar,varchar,varchar,text,jsonb,numeric,varchar,integer) TO qingyu_api;

INSERT INTO app.schema_migrations(version, checksum)
VALUES ('0067_generation_media_failure_accounting', 'generation-media-failure-accounting-v1')
ON CONFLICT (version) DO NOTHING;
COMMIT;
