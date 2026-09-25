-- 用户积分定价、报价快照和注册赠分策略。
BEGIN;
SELECT pg_advisory_xact_lock(70420260968);

ALTER TABLE app.model_catalog
  ADD COLUMN IF NOT EXISTS credit_price numeric(20,6),
  ADD COLUMN IF NOT EXISTS credit_price_unit varchar(24),
  ADD COLUMN IF NOT EXISTS credit_price_version integer NOT NULL DEFAULT 1;
ALTER TABLE app.model_catalog
  DROP CONSTRAINT IF EXISTS model_catalog_credit_price_check,
  ADD CONSTRAINT model_catalog_credit_price_check CHECK (credit_price IS NULL OR credit_price > 0),
  DROP CONSTRAINT IF EXISTS model_catalog_credit_price_unit_check,
  ADD CONSTRAINT model_catalog_credit_price_unit_check CHECK (credit_price_unit IS NULL OR credit_price_unit IN ('request','output','second','thousand_chars'));

CREATE TABLE IF NOT EXISTS app.credit_system_policies (
  policy_key varchar(80) PRIMARY KEY,
  amount numeric(20,6) NOT NULL CHECK (amount > 0),
  effective_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO app.credit_system_policies(policy_key,amount,effective_at)
VALUES ('signup_gift',50,now()) ON CONFLICT(policy_key) DO NOTHING;

CREATE TABLE IF NOT EXISTS app.model_credit_price_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_catalog_id bigint NOT NULL REFERENCES app.model_catalog(id) ON DELETE RESTRICT,
  price_version integer NOT NULL,
  credit_price numeric(20,6),
  credit_price_unit varchar(24),
  changed_by text,
  changed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(model_catalog_id,price_version)
);
ALTER TABLE app.quota_grants DROP CONSTRAINT IF EXISTS quota_grants_source_type_check;
ALTER TABLE app.quota_grants ADD CONSTRAINT quota_grants_source_type_check CHECK (source_type IN ('plan','purchase','manual','refund','signup'));

CREATE TABLE IF NOT EXISTS app.model_credit_quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES app.workspaces(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES app.user_accounts(id) ON DELETE RESTRICT,
  model_catalog_id bigint NOT NULL REFERENCES app.model_catalog(id) ON DELETE RESTRICT,
  task_type varchar(32) NOT NULL CHECK (task_type IN ('image','video','audio','text')),
  price_version integer NOT NULL CHECK (price_version > 0),
  price_unit varchar(24) NOT NULL CHECK (price_unit IN ('request','output','second','thousand_chars')),
  unit_count numeric(20,6) NOT NULL CHECK (unit_count > 0),
  credit_price numeric(20,6) NOT NULL CHECK (credit_price > 0),
  total_credits numeric(20,6) NOT NULL CHECK (total_credits > 0),
  request_hash varchar(64) NOT NULL,
  request_snapshot jsonb NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_by_task_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE app.generation_tasks
  ADD COLUMN IF NOT EXISTS credit_quote_id uuid,
  ADD COLUMN IF NOT EXISTS charged_credits numeric(20,6) NOT NULL DEFAULT 0;
ALTER TABLE app.generation_tasks
  DROP CONSTRAINT IF EXISTS generation_tasks_credit_quote_fk,
  ADD CONSTRAINT generation_tasks_credit_quote_fk FOREIGN KEY (credit_quote_id) REFERENCES app.model_credit_quotes(id) ON DELETE RESTRICT,
  DROP CONSTRAINT IF EXISTS generation_tasks_charged_credits_check,
  ADD CONSTRAINT generation_tasks_charged_credits_check CHECK (charged_credits >= 0);
ALTER TABLE app.model_credit_quotes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS model_credit_quotes_api_access ON app.model_credit_quotes;
CREATE POLICY model_credit_quotes_api_access ON app.model_credit_quotes FOR ALL USING (current_user IN ('qingyu_api','postgres')) WITH CHECK (current_user IN ('qingyu_api','postgres'));
ALTER TABLE app.model_credit_price_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS model_credit_price_history_api_access ON app.model_credit_price_history;
CREATE POLICY model_credit_price_history_api_access ON app.model_credit_price_history FOR ALL USING (current_user IN ('qingyu_api','postgres')) WITH CHECK (current_user IN ('qingyu_api','postgres'));
GRANT SELECT,INSERT,UPDATE ON app.model_credit_quotes,app.model_credit_price_history TO qingyu_api;
GRANT SELECT,INSERT ON app.credit_system_policies TO qingyu_api;

-- 所有经平台异步任务接口提交的任务必须带有效报价；每日免费次数不再作为兜底。
CREATE OR REPLACE FUNCTION app.create_generation_task(
  p_workspace_id uuid, p_user_id uuid, p_task_type varchar,
  p_provider varchar, p_model varchar, p_pricing_version varchar,
  p_prompt text, p_parameters jsonb, p_quantity numeric,
  p_idempotency_key varchar, p_timeout_seconds integer,
  p_model_catalog_id bigint, p_credit_quote_id uuid
) RETURNS app.generation_tasks
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  t app.generation_tasks%ROWTYPE;
  q app.model_credit_quotes%ROWTYPE;
  v_reservation uuid;
  v_usage uuid;
  v_quantity numeric;
  v_snapshot jsonb;
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
       OR t.requested_output_count IS DISTINCT FROM CASE WHEN p_task_type='image' THEN v_quantity::integer ELSE 1 END THEN
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
  INSERT INTO app.generation_tasks(workspace_id,created_by,task_type,provider,model,pricing_version,prompt,parameters,status,request_id,idempotency_key,timeout_at,quota_reservation_id,daily_reservation_id,usage_record_id,credit_quote_id,charged_credits,requested_output_count)
    VALUES(p_workspace_id,p_user_id,COALESCE(p_task_type,'image'),p_provider,p_model,q.price_version::varchar,p_prompt,COALESCE(p_parameters,'{}'::jsonb),'pending',p_idempotency_key,p_idempotency_key,
      now()+make_interval(secs=>GREATEST(10,COALESCE(p_timeout_seconds,600))),v_reservation,NULL,v_usage,q.id,q.total_credits,CASE WHEN p_task_type='image' THEN v_quantity::integer ELSE 1 END)
    RETURNING * INTO t;
  UPDATE app.model_credit_quotes SET consumed_by_task_id=t.id WHERE id=q.id;
  RETURN t;
END;
$$;
REVOKE ALL ON FUNCTION app.create_generation_task(uuid,uuid,varchar,varchar,varchar,varchar,text,jsonb,numeric,varchar,integer,bigint,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.create_generation_task(uuid,uuid,varchar,varchar,varchar,varchar,text,jsonb,numeric,varchar,integer,bigint,uuid) TO qingyu_api;
REVOKE ALL ON FUNCTION app.create_generation_task(uuid,uuid,varchar,varchar,varchar,varchar,text,jsonb,numeric,varchar,integer) FROM qingyu_api;

INSERT INTO app.schema_migrations(version,checksum) VALUES ('0068_model_credit_pricing','model-credit-pricing-v1') ON CONFLICT(version) DO NOTHING;
COMMIT;
