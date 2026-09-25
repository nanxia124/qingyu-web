\set ON_ERROR_STOP on
BEGIN;

DO $$
DECLARE t text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='app' AND table_name='subscriptions' AND column_name='billing_anchor_day'
  ) THEN RAISE EXCEPTION '订阅缺少账期日锚点'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='app' AND table_name='renewal_mandates' AND column_name='collection_owner'
  ) THEN RAISE EXCEPTION '扣款授权没有固定执行方'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='app' AND table_name='renewal_mandates' AND column_name='terms_hash'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='app' AND table_name='renewal_mandates' AND column_name='consented_at'
  ) THEN RAISE EXCEPTION '扣款授权没有保存用户同意内容和时间'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='app' AND table_name='billing_cycles' AND column_name='mandate_id'
  ) THEN RAISE EXCEPTION '续费账期没有绑定用户授权'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='app' AND table_name='billing_cycles' AND column_name='authorized_max_amount_minor'
  ) THEN RAISE EXCEPTION '续费账期没有记录授权金额上限'; END IF;
  FOREACH t IN ARRAY ARRAY['renewal_mandates','billing_cycles','renewal_attempts','renewal_reminders'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='app' AND c.relname=t AND c.relrowsecurity) THEN
      RAISE EXCEPTION '续费表 app.% 未启用行级隔离', t;
    END IF;
    IF has_table_privilege('qingyu_app', 'app.' || t, 'INSERT')
       OR has_table_privilege('qingyu_app', 'app.' || t, 'UPDATE')
       OR has_table_privilege('qingyu_app', 'app.' || t, 'DELETE') THEN
      RAISE EXCEPTION '普通用户角色可直接改续费表 app.%', t;
    END IF;
    IF NOT has_table_privilege('qingyu_api', 'app.' || t, 'SELECT') THEN
      RAISE EXCEPTION 'API 角色缺少续费表 app.% 的读取权限', t;
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='app' AND indexname='renewal_mandates_one_open_per_subscription') THEN
    RAISE EXCEPTION '缺少每份订阅最多一个有效扣款授权的唯一约束';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='app' AND indexname='billing_cycles_due_idx') THEN
    RAISE EXCEPTION '缺少续费周期到期扫描索引';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='billing_cycles_order_id_workspace_id_fkey') THEN
    RAISE EXCEPTION '续费周期没有校验订单和工作空间属于同一空间';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='billing_cycles_mandate_scope_fkey') THEN
    RAISE EXCEPTION '续费账期未校验订阅、空间、执行方、商户账户与授权一致';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='renewal_attempts_provider_scope_fkey') THEN
    RAISE EXCEPTION '扣款尝试未固定账期对应的渠道、商户账户与环境';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='app' AND indexname='renewal_attempts_provider_payment_unique') THEN
    RAISE EXCEPTION '扣款尝试缺少渠道交易号防重复约束';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='billing_cycles_authorized_amount_check') THEN
    RAISE EXCEPTION '续费账期没有授权金额上限约束';
  END IF;
  RAISE NOTICE 'PASS: 续费结构具备空间隔离、单授权执行方、账期授权绑定、商户环境一致性、防重复与到期查询索引';
END $$;

ROLLBACK;
