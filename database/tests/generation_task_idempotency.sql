-- 0047 生成任务重复提交验收；并发领取由 test-generation-claim.mjs 单独验证。
\set ON_ERROR_STOP on
-- 测试自带临时用户和个人工作空间，避免依赖环境残留；全部操作在事务中回滚。
BEGIN;
INSERT INTO app.user_accounts(appwrite_user_id, display_name)
VALUES ('generation-idempotency-test-' || gen_random_uuid(), '生成幂等测试用户')
RETURNING id AS uid \gset
INSERT INTO app.workspaces(type, owner_user_id, name)
VALUES ('personal', :'uid', '生成幂等测试空间')
RETURNING id AS wid \gset
SELECT set_config('app.user_id', :'uid', true);
INSERT INTO app.quota_accounts(workspace_id, quota_code, granted)
VALUES (:'wid', 'monthly', 100);
INSERT INTO app.model_catalog(model_id, display_name, provider, capability, credit_price, credit_price_unit)
VALUES ('generation-idempotency-test-model', '幂等测试模型', 'test', 'image', 1, 'output')
RETURNING id AS model_id \gset
INSERT INTO app.model_credit_quotes(workspace_id,user_id,model_catalog_id,task_type,price_version,price_unit,unit_count,credit_price,total_credits,request_hash,request_snapshot,expires_at)
VALUES (:'wid',:'uid',:'model_id','image',1,'output',1,1,1,repeat('a',64),
  jsonb_build_object('taskType','image','prompt','idempotency test','parameters','{}'::jsonb,'quantity',1),now()+interval '5 minutes')
RETURNING id AS quote_id \gset

CREATE TEMP TABLE generation_task_idempotency_result AS
SELECT * FROM app.create_generation_task(
  :'wid'::uuid, :'uid'::uuid, 'image', 'test', 'test-model', 'test-v1',
  'idempotency test', '{}'::jsonb, 1, 'test-generation-repeat-key', 60, :'model_id'::bigint, :'quote_id'::uuid
);

INSERT INTO generation_task_idempotency_result
SELECT * FROM app.create_generation_task(
  :'wid'::uuid, :'uid'::uuid, 'image', 'test', 'test-model', 'test-v1',
  'idempotency test', '{}'::jsonb, 1, 'test-generation-repeat-key', 60, :'model_id'::bigint, :'quote_id'::uuid
);

DO $$
DECLARE task_count integer; first_id uuid; second_id uuid;
BEGIN
  SELECT count(*) INTO task_count FROM generation_task_idempotency_result;
  SELECT id INTO first_id FROM generation_task_idempotency_result ORDER BY id LIMIT 1;
  SELECT id INTO second_id FROM generation_task_idempotency_result ORDER BY id OFFSET 1 LIMIT 1;
  IF task_count <> 2 OR first_id IS DISTINCT FROM second_id THEN
    RAISE EXCEPTION '重复幂等键没有复用同一任务：返回数=%', task_count;
  END IF;
  SELECT count(*) INTO task_count FROM app.generation_tasks
    WHERE idempotency_key='test-generation-repeat-key';
  IF task_count <> 1 THEN RAISE EXCEPTION '重复幂等键创建了 % 条任务', task_count; END IF;
  SELECT count(*) INTO task_count FROM app.usage_records
    WHERE idempotency_key='test-generation-repeat-key';
  IF task_count <> 1 THEN RAISE EXCEPTION '重复提交产生了 % 条使用记录', task_count; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM app.generation_tasks t
    JOIN app.usage_records u ON u.id=t.usage_record_id AND u.workspace_id=t.workspace_id
    JOIN app.quota_reservations r ON r.id=t.quota_reservation_id
      AND r.workspace_id=t.workspace_id AND r.account_id IS NOT NULL
    WHERE t.id=first_id AND u.quota_reservation_id=t.quota_reservation_id AND u.quantity=1
  ) THEN
    RAISE EXCEPTION '任务、使用记录与积分预留关联或数量不一致';
  END IF;
  RAISE NOTICE 'PASS: 重复幂等键复用同一任务、使用记录和积分预留';
END $$;

ROLLBACK;
