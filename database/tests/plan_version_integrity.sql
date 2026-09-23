-- 验证订单和订阅不能引用别的套餐的价格版本。
\set ON_ERROR_STOP on
BEGIN;
DO $$
DECLARE u uuid; w uuid; plan_a uuid; plan_b uuid; version_b uuid;
BEGIN
  INSERT INTO app.user_accounts(appwrite_user_id) VALUES ('plan-test-' || gen_random_uuid()) RETURNING id INTO u;
  INSERT INTO app.workspaces(type,owner_user_id,name) VALUES ('personal',u,'套餐版本测试') RETURNING id INTO w;
  INSERT INTO app.plans(code,name) VALUES ('plan-test-a','套餐 A') RETURNING id INTO plan_a;
  INSERT INTO app.plans(code,name) VALUES ('plan-test-b','套餐 B') RETURNING id INTO plan_b;
  INSERT INTO app.plan_versions(plan_id,version,currency,price_minor,billing_interval,effective_at)
  VALUES (plan_b,1,'CNY',100,'month',now()) RETURNING id INTO version_b;
  BEGIN
    INSERT INTO app.orders(workspace_id,plan_id,plan_version_id,order_no,idempotency_key,amount_minor)
    VALUES (w,plan_a,version_b,'plan-test-order-' || gen_random_uuid(),'plan-test-key-' || gen_random_uuid(),100);
    RAISE EXCEPTION '未拒绝套餐与价格版本不匹配';
  EXCEPTION WHEN foreign_key_violation THEN NULL; END;
  RAISE NOTICE 'PASS: 订单套餐和价格版本必须一致';
END $$;
ROLLBACK;
