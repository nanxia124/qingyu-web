-- 验证重复点击、金额不一致和已付款订单回退都会被数据库拒绝。
\set ON_ERROR_STOP on
BEGIN;
DO $$
DECLARE u uuid; w uuid; p uuid; o uuid; payment_id uuid;
BEGIN
  INSERT INTO app.user_accounts(appwrite_user_id) VALUES ('payment-test-' || gen_random_uuid()) RETURNING id INTO u;
  INSERT INTO app.workspaces(type,owner_user_id,name) VALUES ('personal',u,'支付幂等测试') RETURNING id INTO w;
  INSERT INTO app.plans(code,name,price_minor) VALUES ('payment-test-' || gen_random_uuid(),'支付测试套餐',100) RETURNING id INTO p;
  INSERT INTO app.orders(workspace_id,plan_id,order_no,idempotency_key,amount_minor)
  VALUES (w,p,'payment-order-' || gen_random_uuid(),'payment-key-' || gen_random_uuid(),100) RETURNING id INTO o;
  BEGIN
    INSERT INTO app.orders(workspace_id,plan_id,order_no,idempotency_key,amount_minor)
    VALUES (w,p,'payment-order-' || gen_random_uuid(),'payment-key-' || gen_random_uuid(),100);
    RAISE EXCEPTION '未拒绝同套餐重复待付款订单';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  BEGIN
    INSERT INTO app.payments(order_id,provider,provider_payment_id,amount_minor)
    VALUES (o,'mock','payment-wrong-' || gen_random_uuid(),99);
    RAISE EXCEPTION '未拒绝支付金额不一致';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%支付金额和订单金额不一致%' THEN RAISE; END IF;
  END;
  INSERT INTO app.payments(order_id,provider,provider_payment_id,amount_minor)
  VALUES (o,'mock','payment-ok-' || gen_random_uuid(),100) RETURNING id INTO payment_id;
  BEGIN
    INSERT INTO app.payments(order_id,provider,provider_payment_id,amount_minor)
    VALUES (o,'mock','payment-duplicate-' || gen_random_uuid(),100);
    RAISE EXCEPTION '未拒绝同订单重复支付尝试';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  UPDATE app.payments SET status='succeeded' WHERE id=payment_id;
  BEGIN
    UPDATE app.orders SET status='paid' WHERE id=o;
    UPDATE app.orders SET status='pending' WHERE id=o;
    RAISE EXCEPTION '未拒绝已付款订单回退';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%已完成的订单不能退回%' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'PASS: 待付款去重、金额校验、支付尝试去重和订单状态不可回退';
END $$;
ROLLBACK;
