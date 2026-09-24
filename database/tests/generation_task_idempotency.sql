-- 0047 生成任务幂等并发保护验收。
-- 需要测试数据库中存在一个有效用户和个人工作空间；全部操作在事务中回滚。
BEGIN;
SELECT u.id AS uid, w.id AS wid
  FROM app.user_accounts u
  JOIN app.workspaces w ON w.owner_user_id=u.id
                       AND w.type='personal'
                       AND w.status='active'
 WHERE u.status='active'
 ORDER BY u.created_at
 LIMIT 1 \gset
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
