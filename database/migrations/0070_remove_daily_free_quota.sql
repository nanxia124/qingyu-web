-- 移除已废弃的每日免费额度；生成与代理用量统一走积分预留。
BEGIN;
SELECT pg_advisory_xact_lock(70420260969);

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
    IF p_refund AND t.quota_reservation_id IS NOT NULL THEN
        PERFORM app.release_quota(t.quota_reservation_id,t.id::text||':release');
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

REVOKE ALL ON FUNCTION app.settle_generation_task_success(uuid,jsonb,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.settle_generation_task_success(uuid,jsonb,text) TO qingyu_api;
REVOKE ALL ON FUNCTION app.fail_generation_task(uuid,text,text,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.fail_generation_task(uuid,text,text,boolean) TO qingyu_api;
REVOKE ALL ON FUNCTION app.fail_generation_task_keep_charge(uuid,text,text) FROM PUBLIC, qingyu_app;
GRANT EXECUTE ON FUNCTION app.fail_generation_task_keep_charge(uuid,text,text) TO qingyu_api;

-- 新任务只能按有效报价预占积分；不再写入每日额度字段。
CREATE OR REPLACE FUNCTION app.create_generation_task(
  p_workspace_id uuid, p_user_id uuid, p_task_type varchar,
  p_provider varchar, p_model varchar, p_pricing_version varchar,
  p_prompt text, p_parameters jsonb, p_quantity numeric,
  p_idempotency_key varchar, p_timeout_seconds integer,
  p_model_catalog_id bigint, p_credit_quote_id uuid
) RETURNS app.generation_tasks
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE t app.generation_tasks%ROWTYPE; q app.model_credit_quotes%ROWTYPE; v_reservation uuid; v_usage uuid; v_quantity numeric; v_snapshot jsonb;
BEGIN
  IF NOT app.has_workspace_access(p_workspace_id) THEN RAISE EXCEPTION '无权访问工作空间'; END IF;
  IF p_idempotency_key IS NULL OR length(btrim(p_idempotency_key))=0 THEN RAISE EXCEPTION '任务幂等键不能为空'; END IF;
  IF app.current_user_id() IS DISTINCT FROM p_user_id THEN RAISE EXCEPTION '任务创建人必须是当前登录用户'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('generation_task:'||p_idempotency_key,70420260947));
  v_quantity:=GREATEST(1,COALESCE(p_quantity,1));
  v_snapshot:=jsonb_build_object('taskType',p_task_type,'prompt',COALESCE(p_prompt,''),'parameters',(COALESCE(p_parameters,'{}'::jsonb)-'model'-'__qingyuCatalogModelId'-'n'),'quantity',v_quantity);
  SELECT * INTO t FROM app.generation_tasks WHERE idempotency_key=p_idempotency_key;
  IF FOUND THEN
    IF t.workspace_id IS DISTINCT FROM p_workspace_id OR t.created_by IS DISTINCT FROM p_user_id THEN RAISE EXCEPTION '任务幂等键已属于其他工作空间或用户'; END IF;
    IF t.credit_quote_id IS DISTINCT FROM p_credit_quote_id THEN RAISE EXCEPTION '同一任务编号不能更换报价'; END IF;
    IF t.task_type IS DISTINCT FROM p_task_type OR t.model IS DISTINCT FROM p_model OR t.prompt IS DISTINCT FROM p_prompt
       OR (t.parameters-'model'-'__qingyuCatalogModelId'-'n') IS DISTINCT FROM (COALESCE(p_parameters,'{}'::jsonb)-'model'-'__qingyuCatalogModelId'-'n')
       OR t.requested_output_count IS DISTINCT FROM (CASE WHEN p_task_type='image' THEN v_quantity::integer ELSE 1 END) THEN
      RAISE EXCEPTION '同一任务编号不能更换模型、参数或生成数量';
    END IF;
    RETURN t;
  END IF;
  IF p_credit_quote_id IS NULL THEN RAISE EXCEPTION '缺少有效的积分报价'; END IF;
  SELECT * INTO q FROM app.model_credit_quotes WHERE id=p_credit_quote_id FOR UPDATE;
  IF NOT FOUND OR q.workspace_id IS DISTINCT FROM p_workspace_id OR q.user_id IS DISTINCT FROM p_user_id OR q.model_catalog_id IS DISTINCT FROM p_model_catalog_id OR q.expires_at<=now() OR q.consumed_by_task_id IS NOT NULL THEN RAISE EXCEPTION '积分报价已失效或与所选模型不一致，请重新确认价格'; END IF;
  IF q.request_snapshot<>v_snapshot THEN RAISE EXCEPTION '生成参数或报价已变化，请重新确认'; END IF;
  SELECT app.reserve_quota(p_workspace_id,'monthly',q.total_credits,p_idempotency_key||':task',now()+make_interval(secs=>GREATEST(10,COALESCE(p_timeout_seconds,600)))) INTO v_reservation;
  INSERT INTO app.usage_records(workspace_id,user_id,feature_code,provider,model,quantity,unit,result,idempotency_key,request_id,metadata,quota_reservation_id)
    VALUES(p_workspace_id,p_user_id,CASE WHEN p_task_type='image' THEN 'image_gen' ELSE 'ai_proxy' END,p_provider,p_model,v_quantity,'credit','reserved',p_idempotency_key,p_idempotency_key,
      jsonb_build_object('task_type',p_task_type,'phase','created','credit_quote_id',q.id,'credits',q.total_credits,'price_version',q.price_version),v_reservation)
    RETURNING id INTO v_usage;
  INSERT INTO app.generation_tasks(workspace_id,created_by,task_type,provider,model,pricing_version,prompt,parameters,status,request_id,idempotency_key,timeout_at,quota_reservation_id,usage_record_id,credit_quote_id,charged_credits,requested_output_count)
    VALUES(p_workspace_id,p_user_id,COALESCE(p_task_type,'image'),p_provider,p_model,q.price_version::varchar,p_prompt,COALESCE(p_parameters,'{}'::jsonb),'pending',p_idempotency_key,p_idempotency_key,
      now()+make_interval(secs=>GREATEST(10,COALESCE(p_timeout_seconds,600))),v_reservation,v_usage,q.id,q.total_credits,CASE WHEN p_task_type='image' THEN v_quantity::integer ELSE 1 END)
    RETURNING * INTO t;
  UPDATE app.model_credit_quotes SET consumed_by_task_id=t.id WHERE id=q.id;
  RETURN t;
END;
$$;
REVOKE ALL ON FUNCTION app.create_generation_task(uuid,uuid,varchar,varchar,varchar,varchar,text,jsonb,numeric,varchar,integer,bigint,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.create_generation_task(uuid,uuid,varchar,varchar,varchar,varchar,text,jsonb,numeric,varchar,integer,bigint,uuid) TO qingyu_api;
DROP FUNCTION IF EXISTS app.create_generation_task(uuid,uuid,varchar,varchar,varchar,varchar,text,jsonb,numeric,varchar,integer);

CREATE OR REPLACE FUNCTION app.check_generation_task_terminal()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE quota_status text;
BEGIN
  IF NEW.status='succeeded' THEN
    IF NEW.quota_reservation_id IS NULL THEN RAISE EXCEPTION '成功任务必须绑定积分预占'; END IF;
    SELECT status INTO quota_status FROM app.quota_reservations WHERE id=NEW.quota_reservation_id;
    IF quota_status IS DISTINCT FROM 'committed' THEN RAISE EXCEPTION '成功任务的积分预占必须已结算'; END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION app.validate_usage_reservation_scope()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.quota_reservation_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM app.quota_reservations r WHERE r.id=NEW.quota_reservation_id AND r.workspace_id=NEW.workspace_id
  ) THEN RAISE EXCEPTION '积分预占与使用记录的工作空间不一致'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS usage_records_reservation_scope_guard ON app.usage_records;
CREATE TRIGGER usage_records_reservation_scope_guard
  BEFORE INSERT OR UPDATE OF workspace_id,quota_reservation_id ON app.usage_records
  FOR EACH ROW EXECUTE FUNCTION app.validate_usage_reservation_scope();

-- 人工对账保留，只能结算或释放积分预占。
CREATE OR REPLACE FUNCTION app.reconcile_provider_usage(
  p_usage_id uuid, p_actor text, p_decision text, p_reason text, p_reference text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE u app.usage_records%ROWTYPE; prior app.usage_reconciliations%ROWTYPE; q app.quota_reservations%ROWTYPE; audit_id uuid;
BEGIN
  IF p_actor IS NULL OR length(btrim(p_actor)) NOT BETWEEN 1 AND 160 OR p_decision IS NULL OR p_decision NOT IN ('committed','released')
     OR p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 1 AND 2000 OR p_reference IS NULL OR length(btrim(p_reference)) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION '必须提供管理员、有效结论、处理理由和供应商凭据';
  END IF;
  SELECT * INTO u FROM app.usage_records WHERE id=p_usage_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '调用记录不存在'; END IF;
  SELECT * INTO prior FROM app.usage_reconciliations WHERE usage_record_id=u.id;
  IF FOUND THEN
    IF prior.decision<>p_decision THEN RAISE EXCEPTION '已有核对结论，不能覆盖'; END IF;
    RETURN prior.id;
  END IF;
  IF u.result<>'unknown' THEN RAISE EXCEPTION '只能核对未知结果'; END IF;
  IF u.quota_reservation_id IS NOT NULL THEN
    SELECT * INTO q FROM app.quota_reservations WHERE id=u.quota_reservation_id FOR UPDATE;
    IF NOT FOUND OR q.workspace_id<>u.workspace_id OR q.status<>'reserved' THEN RAISE EXCEPTION '积分预占归属或状态异常'; END IF;
    UPDATE app.quota_accounts SET reserved=reserved-q.amount,consumed=consumed+CASE WHEN p_decision='committed' THEN q.amount ELSE 0 END,version=version+1,updated_at=now() WHERE id=q.account_id;
    UPDATE app.quota_reservations SET status=p_decision,settled_at=now() WHERE id=q.id;
    INSERT INTO app.quota_ledger(account_id,workspace_id,reservation_id,entry_type,amount,idempotency_key,metadata)
      VALUES(q.account_id,u.workspace_id,q.id,CASE WHEN p_decision='committed' THEN 'commit' ELSE 'release' END,q.amount,'reconcile:'||u.id::text,
        jsonb_build_object('actor',p_actor,'reason',p_reason,'provider_reference',p_reference));
  END IF;
  INSERT INTO app.usage_reconciliations(usage_record_id,workspace_id,actor_admin,decision,reason,provider_reference)
    VALUES(u.id,u.workspace_id,p_actor,p_decision,btrim(p_reason),btrim(p_reference)) RETURNING id INTO audit_id;
  UPDATE app.usage_records SET result=CASE WHEN p_decision='committed' THEN 'committed' ELSE 'failed' END,
    metadata=metadata||jsonb_build_object('reconciliation_id',audit_id) WHERE id=u.id;
  RETURN audit_id;
END $$;
REVOKE ALL ON FUNCTION app.reconcile_provider_usage(uuid,text,text,text,text) FROM PUBLIC,qingyu_app;
GRANT EXECUTE ON FUNCTION app.reconcile_provider_usage(uuid,text,text,text,text) TO qingyu_api;

-- 定时回收只处理过期积分预占和任务，不再扫描每日额度。
CREATE OR REPLACE FUNCTION app.reap_stale_generation_tasks()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE v_task_count integer:=0; v_quota_expired integer:=0; v_alert jsonb; t record; r record;
BEGIN
  FOR t IN SELECT gt.id,gt.created_by FROM app.generation_tasks gt WHERE status IN ('pending','running') AND timeout_at IS NOT NULL AND timeout_at<now() FOR UPDATE OF gt SKIP LOCKED LOOP
    IF t.created_by IS NULL THEN
      INSERT INTO app.platform_alerts(alert_type,severity,workspace_id,summary,detail)
        SELECT 'generation_task_missing_actor','critical',workspace_id,'超时任务缺少创建人，暂未自动释放额度',jsonb_build_object('task_id',id) FROM app.generation_tasks WHERE id=t.id;
      CONTINUE;
    END IF;
    PERFORM set_config('app.user_id',t.created_by::text,true);
    PERFORM app.fail_generation_task(t.id,'timeout','任务超时未完成，已退还积分',true);
    v_task_count:=v_task_count+1;
  END LOOP;
  FOR r IN SELECT q.id,q.account_id,q.workspace_id,q.amount FROM app.quota_reservations q WHERE q.status='reserved' AND q.expires_at<now() FOR UPDATE OF q SKIP LOCKED LOOP
    UPDATE app.quota_accounts SET reserved=GREATEST(0,reserved-r.amount),version=version+1,updated_at=now() WHERE id=r.account_id;
    UPDATE app.quota_reservations SET status='expired',settled_at=now() WHERE id=r.id;
    INSERT INTO app.quota_ledger(account_id,workspace_id,reservation_id,entry_type,amount,idempotency_key,metadata)
      VALUES(r.account_id,r.workspace_id,r.id,'expire',r.amount,'expire:'||r.id::text,jsonb_build_object('reaper',true,'reason','reservation_expired'));
    v_quota_expired:=v_quota_expired+1;
  END LOOP;
  INSERT INTO app.platform_alerts(alert_type,severity,workspace_id,summary,detail)
  SELECT 'quota_conservation_violation','critical',a.workspace_id,
    format('额度账户 %s 不守恒: reserved=%s consumed=%s granted=%s',a.quota_code,a.reserved,a.consumed,a.granted),
    jsonb_build_object('quota_account_id',a.id,'granted',a.granted,'reserved',a.reserved,'consumed',a.consumed)
  FROM app.quota_accounts a WHERE a.reserved+a.consumed>a.granted+0.000001 ON CONFLICT DO NOTHING;
  RETURN jsonb_build_object('refunded_tasks',v_task_count,'expired_quota_reservations',v_quota_expired,'ran_at',now());
END $$;

DROP TABLE IF EXISTS app.daily_usage_reservations CASCADE;
ALTER TABLE app.usage_records DROP COLUMN IF EXISTS daily_reservation_id;
ALTER TABLE app.generation_tasks DROP COLUMN IF EXISTS daily_reservation_id;

INSERT INTO app.schema_migrations(version, checksum)
VALUES ('0070_remove_daily_free_quota', 'remove-daily-free-quota-v1')
ON CONFLICT (version) DO NOTHING;

COMMIT;

