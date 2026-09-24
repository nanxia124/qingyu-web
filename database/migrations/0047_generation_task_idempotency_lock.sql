-- 0047 生图任务幂等并发保护。
-- 同一个客户端请求可能因为网络卡顿重复提交；这里在数据库事务内按幂等键串行化，
-- 确保只会产生一条任务和一笔预扣。
BEGIN;
SELECT pg_advisory_xact_lock(70420260947);

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
BEGIN
  IF NOT app.has_workspace_access(p_workspace_id) THEN RAISE EXCEPTION '无权访问工作空间'; END IF;
  IF p_idempotency_key IS NULL OR length(btrim(p_idempotency_key)) = 0 THEN RAISE EXCEPTION '任务幂等键不能为空'; END IF;
  IF app.current_user_id() IS DISTINCT FROM p_user_id THEN RAISE EXCEPTION '任务创建人必须是当前登录用户'; END IF;

  -- 先锁定幂等键，再读取已有任务；并发重复提交会在这里排队。
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

  IF EXISTS (SELECT 1 FROM app.subscriptions s
             WHERE s.workspace_id=p_workspace_id AND s.status IN ('trialing','active','past_due')) THEN
    SELECT app.reserve_quota(p_workspace_id,'monthly',v_quantity,p_idempotency_key||':task',v_timeout)
      INTO v_reservation;
  ELSE
    SELECT app.reserve_free_daily_usage(p_workspace_id,p_user_id,'image_gen',v_quantity,
                                        p_idempotency_key||':task',20,v_timeout)
      INTO v_daily;
  END IF;

  INSERT INTO app.usage_records(workspace_id,user_id,feature_code,provider,model,quantity,unit,result,
      idempotency_key,request_id,metadata,quota_reservation_id,daily_reservation_id)
    VALUES(p_workspace_id,p_user_id,CASE WHEN p_task_type='image' THEN 'image_gen' ELSE 'ai_proxy' END,
      p_provider,p_model,v_quantity,'request','reserved',p_idempotency_key,p_idempotency_key,
      jsonb_build_object('task_type',p_task_type,'phase','created'),v_reservation,v_daily)
    RETURNING id INTO v_usage;

  INSERT INTO app.generation_tasks(workspace_id,created_by,task_type,provider,model,pricing_version,prompt,parameters,
      status,request_id,idempotency_key,timeout_at,quota_reservation_id,daily_reservation_id,usage_record_id)
    VALUES(p_workspace_id,p_user_id,COALESCE(p_task_type,'image'),p_provider,p_model,p_pricing_version,p_prompt,
      COALESCE(p_parameters,'{}'::jsonb),'pending',p_idempotency_key,p_idempotency_key,v_timeout,
      v_reservation,v_daily,v_usage)
    RETURNING * INTO t;
  RETURN t;
END $$;

INSERT INTO app.schema_migrations(version, checksum)
VALUES ('0047_generation_task_idempotency_lock', 'generation-task-idempotency-lock-v1')
ON CONFLICT (version) DO NOTHING;
COMMIT;
