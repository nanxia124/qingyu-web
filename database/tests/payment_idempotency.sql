-- 验证重复待付订单会拦截；不同实收必须逐笔留账，平台交易号仍不可重复绑定。
\set ON_ERROR_STOP on
BEGIN;
DO $$
DECLARE u uuid; w uuid; p uuid; o uuid; payment_id uuid; mismatch_payment_id uuid; receipt_count integer;
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
  INSERT INTO app.payments(order_id,provider,provider_payment_id,status,amount_minor,currency)
  VALUES (o,'mock','payment-wrong-' || gen_random_uuid(),'succeeded',99,'CNY') RETURNING id INTO mismatch_payment_id;
  INSERT INTO app.payments(order_id,provider,provider_payment_id,status,amount_minor,currency)
  VALUES (o,'mock','payment-ok-' || gen_random_uuid(),'succeeded',100,'CNY') RETURNING id INTO payment_id;
  BEGIN
    INSERT INTO app.payments(order_id,provider,provider_payment_id,status,amount_minor,currency)
    SELECT o,'mock',provider_payment_id,'succeeded',100,'CNY' FROM app.payments WHERE id=payment_id;
    RAISE EXCEPTION '未拒绝重复使用支付平台交易号';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  SELECT count(*) INTO receipt_count FROM app.payments WHERE order_id=o AND status='succeeded';
  IF receipt_count<>2 OR (SELECT amount_minor FROM app.payments WHERE id=mismatch_payment_id)<>99 THEN
    RAISE EXCEPTION '没有保留每笔成功实收的真实金额';
  END IF;
  BEGIN
    UPDATE app.orders SET status='paid' WHERE id=o;
    UPDATE app.orders SET status='pending' WHERE id=o;
    RAISE EXCEPTION '未拒绝已付款订单回退';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%已完成的订单不能退回%' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'PASS: 待付款去重、不同实收金额留账、平台交易号去重和订单状态不可回退';
END $$;
ROLLBACK;
