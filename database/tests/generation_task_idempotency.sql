-- 0047 生成任务幂等并发保护验收。
-- 测试自带临时用户和个人工作空间，避免依赖环境残留；全部操作在事务中回滚。
BEGIN;
INSERT INTO app.user_accounts(appwrite_user_id, display_name)
VALUES ('generation-idempotency-test-' || gen_random_uuid(), '生成幂等测试用户')
RETURNING id AS uid \gset
INSERT INTO app.workspaces(type, owner_user_id, name)
VALUES ('personal', :'uid', '生成幂等测试空间')
RETURNING id AS wid \gset
SELECT set_config('app.user_id', :'uid', true);

CREATE TEMP TABLE generation_task_idempotency_result AS
SELECT * FROM app.create_generation_task(
  :'wid'::uuid, :'uid'::uuid, 'image', 'test', 'test-model', 'test-v1',
  'idempotency test', '{}'::jsonb, 1, 'test-generation-repeat-key', 60
);

INSERT INTO generation_task_idempotency_result
SELECT * FROM app.create_generation_task(
  :'wid'::uuid, :'uid'::uuid, 'image', 'test', 'test-model', 'test-v1',
  'idempotency test', '{}'::jsonb, 1, 'test-generation-repeat-key', 60
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
  RAISE NOTICE 'PASS: 重复幂等键复用同一任务且只保留一条任务';
END $$;

ROLLBACK;
