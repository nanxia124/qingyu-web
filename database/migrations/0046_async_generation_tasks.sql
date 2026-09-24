-- 0046 生图异步任务化、超时自动释放预扣额度、管理员审计/对账/异常告警。
-- 目标：把同步代理里“上游超时→用量卡在 unknown→额度长期预占”的不确定状态，
--       收敛成显式任务状态机 pending/running/succeeded/failed/refunded，
--       并由数据库受控函数 + 后台 reaper 自动回收过期预占额度。
-- 权限边界：所有状态流转必须经过 app 模式下的 SECURITY DEFINER 函数，普通业务账号不能直改。
BEGIN;
SELECT pg_advisory_xact_lock(70420260946);

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. generation_tasks 状态机迁移：pending/running/succeeded/failed/refunded
-- ─────────────────────────────────────────────────────────────────────────────
-- 存量状态映射：queued→pending；cancel_requested/reconciling/cancelled→failed。
UPDATE app.generation_tasks SET status='pending' WHERE status='queued';
UPDATE app.generation_tasks SET status='failed'
  WHERE status IN ('cancel_requested','reconciling','cancelled');

-- 旧 CHECK 约束名按惯例由表名 + 列名派生；显式查找后删除，避免空库/已存在差异。
DO $$
DECLARE c text;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
     WHERE conrelid='app.generation_tasks'::regclass AND contype='c'
       AND conname LIKE 'generation_tasks_status_%'
  LOOP
    EXECUTE format('ALTER TABLE app.generation_tasks DROP CONSTRAINT %I', c);
  END LOOP;
END $$;

ALTER TABLE app.generation_tasks
  ADD CONSTRAINT generation_tasks_status_check
  CHECK (status IN ('pending','running','succeeded','failed','refunded'));

-- 任务与预扣额度、用量流水、超时点、供应商任务句柄绑定。
ALTER TABLE app.generation_tasks ADD COLUMN IF NOT EXISTS quota_reservation_id uuid;
ALTER TABLE app.generation_tasks ADD COLUMN IF NOT EXISTS daily_reservation_id uuid;
ALTER TABLE app.generation_tasks ADD COLUMN IF NOT EXISTS usage_record_id uuid;
ALTER TABLE app.generation_tasks ADD COLUMN IF NOT EXISTS timeout_at timestamptz;
ALTER TABLE app.generation_tasks ADD COLUMN IF NOT EXISTS provider_task_id varchar(200);
ALTER TABLE app.generation_tasks ADD COLUMN IF NOT EXISTS error_message text;
ALTER TABLE app.generation_tasks ADD COLUMN IF NOT EXISTS outputs jsonb NOT NULL DEFAULT '[]'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='generation_tasks_quota_reservation_fk' AND conrelid='app.generation_tasks'::regclass) THEN
    ALTER TABLE app.generation_tasks ADD CONSTRAINT generation_tasks_quota_reservation_fk
      FOREIGN KEY (quota_reservation_id) REFERENCES app.quota_reservations(id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='generation_tasks_daily_reservation_fk' AND conrelid='app.generation_tasks'::regclass) THEN
    ALTER TABLE app.generation_tasks ADD CONSTRAINT generation_tasks_daily_reservation_fk
      FOREIGN KEY (daily_reservation_id) REFERENCES app.daily_usage_reservations(id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='generation_tasks_usage_record_fk' AND conrelid='app.generation_tasks'::regclass) THEN
    ALTER TABLE app.generation_tasks ADD CONSTRAINT generation_tasks_usage_record_fk
      FOREIGN KEY (usage_record_id) REFERENCES app.usage_records(id) ON DELETE RESTRICT;
  END IF;
END $$;

-- pending/running 是“在途”状态，reaper 按它扫超时。
CREATE INDEX IF NOT EXISTS generation_tasks_inflight_idx
  ON app.generation_tasks(timeout_at)
  WHERE status IN ('pending','running');

-- 终态必须自洽：succeeded 必须有已结算的预占；refunded 必须已释放预占。
CREATE OR REPLACE FUNCTION app.check_generation_task_terminal()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  quota_status text;
  daily_status text;
BEGIN
  IF NEW.status = 'succeeded' THEN
    IF (NEW.quota_reservation_id IS NOT NULL AND NEW.daily_reservation_id IS NOT NULL)
       OR (NEW.quota_reservation_id IS NULL AND NEW.daily_reservation_id IS NULL) THEN
      RAISE EXCEPTION '成功任务必须且只能绑定一种额度预占';
    END IF;
    IF NEW.quota_reservation_id IS NOT NULL THEN
      SELECT status INTO quota_status FROM app.quota_reservations WHERE id=NEW.quota_reservation_id;
      IF quota_status IS DISTINCT FROM 'committed' THEN
        RAISE EXCEPTION '成功任务的月度额度预占必须已结算';
      END IF;
    ELSE
      SELECT status INTO daily_status FROM app.daily_usage_reservations WHERE id=NEW.daily_reservation_id;
      IF daily_status IS DISTINCT FROM 'committed' THEN
        RAISE EXCEPTION '成功任务的每日额度预占必须已结算';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS generation_tasks_terminal_integrity ON app.generation_tasks;
CREATE TRIGGER generation_tasks_terminal_integrity
  BEFORE UPDATE OF status ON app.generation_tasks
  FOR EACH ROW EXECUTE FUNCTION app.check_generation_task_terminal();

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. 受控任务流转函数（由后端事务调用，普通账号无直改权限）
-- ─────────────────────────────────────────────────────────────────────────────
-- 创建任务：预占额度 + 建 pending 任务，一个事务完成。幂等键重复返回原任务。
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
  SELECT * INTO t FROM app.generation_tasks WHERE idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF t.workspace_id IS DISTINCT FROM p_workspace_id OR t.created_by IS DISTINCT FROM p_user_id THEN
      RAISE EXCEPTION '任务幂等键已属于其他工作空间或用户';
    END IF;
    RETURN t;
  END IF;

  v_quantity := GREATEST(0, COALESCE(p_quantity,1));
  v_timeout := now() + make_interval(secs => GREATEST(10, COALESCE(p_timeout_seconds,600)));

  -- 付费月度额度 / 免费每日额度二选一，与 recordProviderUsage 口径一致。
  IF v_quantity > 0 THEN
    IF EXISTS (SELECT 1 FROM app.subscriptions s WHERE s.workspace_id=p_workspace_id AND s.status IN ('trialing','active','past_due')) THEN
      SELECT app.reserve_quota(p_workspace_id,'monthly',v_quantity,p_idempotency_key||':task',v_timeout) INTO v_reservation;
    ELSE
      SELECT app.reserve_free_daily_usage(p_workspace_id,p_user_id,'image_gen',v_quantity,p_idempotency_key||':task',20,v_timeout) INTO v_daily;
    END IF;
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

-- 标记开始调用上游。
CREATE OR REPLACE FUNCTION app.mark_generation_task_running(p_task_id uuid, p_provider_task_id varchar)
RETURNS app.generation_tasks
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE t app.generation_tasks%ROWTYPE;
BEGIN
  SELECT * INTO t FROM app.generation_tasks WHERE id=p_task_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '任务不存在'; END IF;
  IF NOT app.has_workspace_access(t.workspace_id) THEN RAISE EXCEPTION '无权访问工作空间'; END IF;
  IF t.status NOT IN ('pending') THEN RETURN t; END IF;
  UPDATE app.generation_tasks SET status='running', started_at=now(),
      provider_task_id=COALESCE(p_provider_task_id,provider_task_id), updated_at=now()
    WHERE id=t.id RETURNING * INTO t;
  RETURN t;
END $$;

-- 成功：结算预占（commit），任务→succeeded。
CREATE OR REPLACE FUNCTION app.settle_generation_task_success(p_task_id uuid, p_outputs jsonb, p_provider_ref text)
RETURNS app.generation_tasks
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE t app.generation_tasks%ROWTYPE;
BEGIN
  SELECT * INTO t FROM app.generation_tasks WHERE id=p_task_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '任务不存在'; END IF;
  IF NOT app.has_workspace_access(t.workspace_id) THEN RAISE EXCEPTION '无权访问工作空间'; END IF;
  IF t.status='succeeded' THEN RETURN t; END IF;
  IF t.status NOT IN ('running','pending') THEN RAISE EXCEPTION '任务已结束，不能再结算: %', t.status; END IF;

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
END $$;

-- 失败：refund=真则释放预占额度，任务→refunded；否则任务→failed（额度已被其他路径处理）。
CREATE OR REPLACE FUNCTION app.fail_generation_task(
  p_task_id uuid, p_error_code text, p_error_message text, p_refund boolean
) RETURNS app.generation_tasks
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE t app.generation_tasks%ROWTYPE;
BEGIN
  SELECT * INTO t FROM app.generation_tasks WHERE id=p_task_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '任务不存在'; END IF;
  IF NOT app.has_workspace_access(t.workspace_id) THEN RAISE EXCEPTION '无权访问工作空间'; END IF;
  IF t.status IN ('succeeded','refunded') THEN RETURN t; END IF;

  IF p_refund THEN
    IF t.quota_reservation_id IS NOT NULL THEN
      PERFORM app.release_quota(t.quota_reservation_id, t.id::text||':release');
    ELSIF t.daily_reservation_id IS NOT NULL THEN
      PERFORM app.release_free_daily_usage(t.daily_reservation_id, t.id::text||':release');
    END IF;
  END IF;
  IF t.usage_record_id IS NOT NULL THEN
    UPDATE app.usage_records SET result=CASE WHEN p_refund THEN 'released' ELSE 'failed' END,
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('phase','finished','error',p_error_code)
      WHERE id=t.usage_record_id;
  END IF;
  UPDATE app.generation_tasks SET status=CASE WHEN p_refund THEN 'refunded' ELSE 'failed' END,
      finished_at=now(), error_code=LEFT(COALESCE(p_error_code,'unknown'),120),
      error_message=LEFT(COALESCE(p_error_message,''),2000), updated_at=now()
    WHERE id=t.id RETURNING * INTO t;
  RETURN t;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. 超时自动释放预扣额度（reaper，由后端定时调用）
-- ─────────────────────────────────────────────────────────────────────────────
-- 一次扫三类：超时在途任务（→refunded）、过期月度预占（→expired 并回滚 reserved）、
-- 过期每日预占（→expired）。发现账户不守恒时写 platform_alerts。
CREATE OR REPLACE FUNCTION app.reap_stale_generation_tasks()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_task_count integer := 0;
  v_quota_expired integer := 0;
  v_daily_expired integer := 0;
  v_alert jsonb;
  t record;
  r record;
BEGIN
  -- 3.1 在途任务超时 → refunded（释放其预占）
  FOR t IN
    SELECT gt.id, gt.created_by FROM app.generation_tasks gt
     WHERE status IN ('pending','running') AND timeout_at IS NOT NULL AND timeout_at < now()
     FOR UPDATE OF gt SKIP LOCKED
  LOOP
    IF t.created_by IS NULL THEN
      INSERT INTO app.platform_alerts(alert_type,severity,workspace_id,summary,detail)
        SELECT 'generation_task_missing_actor','critical',workspace_id,
               '超时任务缺少创建人，暂未自动释放额度',jsonb_build_object('task_id',id)
          FROM app.generation_tasks WHERE id=t.id;
      CONTINUE;
    END IF;
    PERFORM set_config('app.user_id', t.created_by::text, true);
    PERFORM app.fail_generation_task(t.id,'timeout','任务超时未完成，已退还积分',true);
    v_task_count := v_task_count + 1;
  END LOOP;

  -- 3.2 月度预占过期仍 reserved → expired，回滚账户 reserved 计数并写流水。
  FOR r IN
    SELECT q.id, q.account_id, q.workspace_id, q.amount FROM app.quota_reservations q
     WHERE q.status='reserved' AND q.expires_at < now()
     FOR UPDATE OF q SKIP LOCKED
  LOOP
    UPDATE app.quota_accounts
       SET reserved=GREATEST(0, reserved - r.amount), version=version+1, updated_at=now()
     WHERE id=r.account_id;
    UPDATE app.quota_reservations SET status='expired', settled_at=now() WHERE id=r.id;
    INSERT INTO app.quota_ledger(account_id,workspace_id,reservation_id,entry_type,amount,idempotency_key,metadata)
      VALUES(r.account_id,r.workspace_id,r.id,'expire',r.amount,'expire:'||r.id::text,
             jsonb_build_object('reaper',true,'reason','reservation_expired'));
    v_quota_expired := v_quota_expired + 1;
  END LOOP;

  -- 3.3 每日免费预占过期仍 reserved → expired（聚合口径自动释放，无需改余额）。
  WITH expired AS (
    UPDATE app.daily_usage_reservations SET status='expired', settled_at=now()
     WHERE status='reserved' AND expires_at < now()
     RETURNING 1
  ) SELECT count(*) INTO v_daily_expired FROM expired;

  -- 3.4 守恒巡检：reserved+consumed 不应超过 granted；任何账户违反即告警。
  INSERT INTO app.platform_alerts(alert_type,severity,workspace_id,summary,detail)
  SELECT 'quota_conservation_violation','critical',a.workspace_id,
         format('额度账户 %s 不守恒: reserved=%s consumed=%s granted=%s', a.quota_code, a.reserved, a.consumed, a.granted),
         jsonb_build_object('quota_account_id',a.id,'granted',a.granted,'reserved',a.reserved,'consumed',a.consumed)
    FROM app.quota_accounts a
   WHERE a.reserved + a.consumed > a.granted + 0.000001
   ON CONFLICT DO NOTHING;

  RETURN jsonb_build_object(
    'refunded_tasks', v_task_count,
    'expired_quota_reservations', v_quota_expired,
    'expired_daily_reservations', v_daily_expired,
    'ran_at', now()
  );
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. 管理员审计日志（只追加）
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app.admin_audit_logs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid REFERENCES app.workspaces(id) ON DELETE SET NULL,
    actor varchar(160) NOT NULL,
    action varchar(120) NOT NULL,
    target_type varchar(80),
    target_id varchar(160),
    summary text,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    ip inet,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS admin_audit_logs_actor_idx ON app.admin_audit_logs(actor, created_at DESC);
CREATE INDEX IF NOT EXISTS admin_audit_logs_workspace_idx ON app.admin_audit_logs(workspace_id, created_at DESC);

CREATE OR REPLACE FUNCTION app.prevent_admin_audit_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'admin_audit_logs 只允许追加，不能修改或删除'; END $$;
DROP TRIGGER IF EXISTS admin_audit_logs_immutable ON app.admin_audit_logs;
CREATE TRIGGER admin_audit_logs_immutable
  BEFORE UPDATE OR DELETE ON app.admin_audit_logs
  FOR EACH ROW EXECUTE FUNCTION app.prevent_admin_audit_mutation();

-- 管理员写审计的受控入口。
CREATE OR REPLACE FUNCTION app.write_admin_audit(
  p_actor varchar, p_action varchar, p_workspace_id uuid,
  p_target_type varchar, p_target_id varchar, p_summary text, p_metadata jsonb, p_ip inet
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE v_id uuid;
BEGIN
  IF p_actor IS NULL OR length(btrim(p_actor)) NOT BETWEEN 1 AND 160
     OR p_action IS NULL OR length(btrim(p_action)) NOT BETWEEN 1 AND 120 THEN
    RAISE EXCEPTION '审计必须包含管理员与动作';
  END IF;
  INSERT INTO app.admin_audit_logs(workspace_id,actor,action,target_type,target_id,summary,metadata,ip)
    VALUES(p_workspace_id,p_actor,p_action,COALESCE(p_target_type,''),COALESCE(p_target_id,''),p_summary,
           COALESCE(p_metadata,'{}'::jsonb),p_ip)
    RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. 异常告警表
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app.platform_alerts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    alert_type varchar(80) NOT NULL,
    severity varchar(16) NOT NULL CHECK (severity IN ('info','warn','critical')),
    workspace_id uuid REFERENCES app.workspaces(id) ON DELETE SET NULL,
    summary text NOT NULL,
    detail jsonb NOT NULL DEFAULT '{}'::jsonb,
    status varchar(16) NOT NULL DEFAULT 'open' CHECK (status IN ('open','ack','closed')),
    created_at timestamptz NOT NULL DEFAULT now(),
    acknowledged_at timestamptz,
    acknowledged_by varchar(160)
);
-- 同类型同空间每小时最多一条，防止 reaper 刷爆告警。
-- 使用 UTC 的 timestamp（不带时区）参与索引，避免 PostgreSQL 对
-- date_trunc(timestamptz) 的稳定性限制导致迁移失败。
CREATE UNIQUE INDEX IF NOT EXISTS platform_alerts_dedup_idx
  ON app.platform_alerts(alert_type,
     COALESCE(workspace_id,'00000000-0000-0000-0000-000000000000'),
     date_trunc('hour', created_at AT TIME ZONE 'UTC'));
CREATE INDEX IF NOT EXISTS platform_alerts_open_idx ON app.platform_alerts(status, created_at DESC) WHERE status='open';

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. 对账：额度账户账面 vs 流水汇总
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW app.v_quota_reconciliation AS
SELECT a.id AS quota_account_id, a.workspace_id, a.quota_code,
       a.granted, a.reserved, a.consumed, a.available,
       COALESCE((SELECT sum(amount) FROM app.quota_ledger l WHERE l.account_id=a.id AND l.entry_type='reserve'),0)  AS ledger_reserved,
       COALESCE((SELECT sum(amount) FROM app.quota_ledger l WHERE l.account_id=a.id AND l.entry_type='commit'),0)   AS ledger_committed,
       COALESCE((SELECT sum(amount) FROM app.quota_ledger l WHERE l.entry_type IN ('release','expire') AND l.account_id=a.id),0) AS ledger_released,
       (a.granted - a.reserved - a.consumed
        - COALESCE((SELECT sum(CASE l.entry_type WHEN 'reserve' THEN l.amount WHEN 'commit' THEN l.amount
                  WHEN 'release' THEN -l.amount WHEN 'expire' THEN -l.amount ELSE 0 END)
              FROM app.quota_ledger l WHERE l.account_id=a.id),0)) AS drift
  FROM app.quota_accounts a;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. 权限：业务账号只能执行受控函数，不能直改任务/审计表
-- ─────────────────────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION app.create_generation_task(uuid,uuid,varchar,varchar,varchar,varchar,text,jsonb,numeric,varchar,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.mark_generation_task_running(uuid,varchar) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.settle_generation_task_success(uuid,jsonb,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.fail_generation_task(uuid,text,text,boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.reap_stale_generation_tasks() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.write_admin_audit(varchar,varchar,uuid,varchar,varchar,text,jsonb,inet) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.create_generation_task(uuid,uuid,varchar,varchar,varchar,varchar,text,jsonb,numeric,varchar,integer) TO qingyu_api;
GRANT EXECUTE ON FUNCTION app.mark_generation_task_running(uuid,varchar) TO qingyu_api;
GRANT EXECUTE ON FUNCTION app.settle_generation_task_success(uuid,jsonb,text) TO qingyu_api;
GRANT EXECUTE ON FUNCTION app.fail_generation_task(uuid,text,text,boolean) TO qingyu_api;
-- reaper 由后端以业务账号定时调用；审计写入同理。
GRANT EXECUTE ON FUNCTION app.reap_stale_generation_tasks() TO qingyu_api;
GRANT EXECUTE ON FUNCTION app.write_admin_audit(varchar,varchar,uuid,varchar,varchar,text,jsonb,inet) TO qingyu_api;
GRANT SELECT ON app.v_quota_reconciliation TO qingyu_api;
GRANT SELECT ON app.platform_alerts TO qingyu_api;

INSERT INTO app.schema_migrations(version, checksum)
VALUES ('0046_async_generation_tasks', 'async-generation-tasks-v1')
ON CONFLICT (version) DO NOTHING;
COMMIT;

