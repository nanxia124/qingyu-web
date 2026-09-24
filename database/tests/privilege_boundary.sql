\set ON_ERROR_STOP on
BEGIN;

-- 检查普通业务账号不能直接触碰身份、成员、权限、支付和配额事实。
SET LOCAL ROLE qingyu_app;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'user_accounts','teams','team_memberships','roles','permissions',
    'role_permissions','role_bindings','user_devices','user_sessions',
    'security_events','audit_logs','outbox_events','subscriptions',
    'orders','payments','usage_records','quota_grants','quota_allocations',
    'provider_credentials','daily_usage_reservations','usage_reconciliations','invoice_requests','invoice_request_orders','refunds','payment_events','backup_runs','backup_copies','restore_drills','schema_migrations'
  ] LOOP
    IF has_table_privilege(current_user, 'app.' || t, 'INSERT')
       OR has_table_privilege(current_user, 'app.' || t, 'UPDATE')
       OR has_table_privilege(current_user, 'app.' || t, 'DELETE') THEN
      RAISE EXCEPTION '权限边界失败：qingyu_app 仍可直接写入 app.%', t;
    END IF;
  END LOOP;
  IF NOT has_table_privilege(current_user, 'app.assets', 'INSERT') THEN
    RAISE EXCEPTION '内容表没有保留业务写入权限';
  END IF;
  RAISE NOTICE 'PASS: 身份、成员、权限、支付、配额和审计表已禁止普通账号直接写入';
END $$;

ROLLBACK;
