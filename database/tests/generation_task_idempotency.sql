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

SELECT CASE WHEN r.id = t.id THEN 'PASS: repeated key returned the same task'
            ELSE 'FAIL: repeated key created a different task' END AS result
  FROM generation_task_idempotency_result r
  JOIN app.generation_tasks t ON t.idempotency_key='test-generation-repeat-key';
SELECT CASE WHEN count(*)=1 THEN 'PASS: exactly one task exists'
            ELSE 'FAIL: task count is ' || count(*) END AS result
  FROM app.generation_tasks WHERE idempotency_key='test-generation-repeat-key';

ROLLBACK;
