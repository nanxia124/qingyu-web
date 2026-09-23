\set ON_ERROR_STOP on
BEGIN;
INSERT INTO app.user_accounts(appwrite_user_id) VALUES ('billing-test-' || gen_random_uuid()) RETURNING id \gset billing_user_
INSERT INTO app.workspaces(type,owner_user_id,name) VALUES ('personal',:'billing_user_id','额度测试空间') RETURNING id \gset billing_space_
INSERT INTO app.quota_accounts(workspace_id,quota_code,granted) VALUES (:'billing_space_id','image.generate',10);
SELECT :'billing_user_id'::text AS billing_context \gset
SET LOCAL ROLE qingyu_app;
SELECT set_config('app.user_id', :'billing_context', true);
SELECT set_config('test.billing_space', :'billing_space_id', false);
SELECT app.reserve_quota(:'billing_space_id','image.generate',3,'test-reserve-1',now()+interval '10 minutes') AS reservation_id \gset
SELECT app.reserve_quota(:'billing_space_id','image.generate',3,'test-reserve-1',now()+interval '10 minutes') = :'reservation_id'::uuid AS same_idempotent \gset
SELECT CASE WHEN :'same_idempotent'::boolean THEN 1 ELSE 1/0 END AS idempotency_check;
SELECT app.settle_quota(:'reservation_id'::uuid,'test-settle-1');
SELECT app.reserve_quota(:'billing_space_id','image.generate',7,'test-reserve-2',now()+interval '10 minutes') AS reservation_id_2 \gset
DO $$ BEGIN
  PERFORM app.reserve_quota(current_setting('test.billing_space')::uuid,'image.generate',1,'test-over-limit',now()+interval '10 minutes');
  RAISE EXCEPTION '额度超扣未被拒绝';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM NOT LIKE '额度不足' THEN RAISE; END IF;
END $$;
SELECT app.release_quota(:'reservation_id_2'::uuid,'test-release-1');
RESET ROLE;
DO $$
DECLARE r numeric; c numeric; v numeric;
BEGIN
  SELECT granted,reserved,consumed INTO r,c,v FROM app.quota_accounts WHERE workspace_id=current_setting('test.billing_space')::uuid;
  IF r<>10 OR c<>0 OR v<>3 THEN RAISE EXCEPTION '额度守恒失败 granted=% reserved=% consumed=%',r,c,v; END IF;
  RAISE NOTICE 'PASS: 预占幂等、超额拒绝、结算、释放和额度守恒';
END $$;
ROLLBACK;
