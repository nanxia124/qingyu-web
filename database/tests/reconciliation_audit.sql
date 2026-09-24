\set ON_ERROR_STOP on
BEGIN;

INSERT INTO app.user_accounts(appwrite_user_id, display_name)
VALUES ('reconciliation-audit-test-' || gen_random_uuid(), '对账测试用户')
RETURNING id AS test_user \gset
INSERT INTO app.workspaces(type, owner_user_id, name)
VALUES ('personal', :'test_user', '对账测试空间')
RETURNING id AS test_workspace \gset
INSERT INTO app.quota_accounts(workspace_id, quota_code, granted, reserved, consumed)
VALUES (:'test_workspace', 'monthly', 100, 0, 0)
RETURNING id AS test_account \gset
INSERT INTO app.quota_ledger(account_id, workspace_id, entry_type, amount, idempotency_key)
VALUES (:'test_account', :'test_workspace', 'grant', 100, 'reconciliation-audit-grant');
SELECT set_config('test.reconciliation_account', :'test_account'::text, true);

DO $$
DECLARE drift numeric;
BEGIN
  SELECT v.drift INTO drift FROM app.v_quota_reconciliation v WHERE v.quota_account_id=current_setting('test.reconciliation_account')::uuid;
  IF drift <> 0 THEN RAISE EXCEPTION '无消耗额度被错误标记为差额：%', drift; END IF;
  RAISE NOTICE 'PASS: 无消耗额度对账差额为 0';
END $$;

SET LOCAL ROLE qingyu_api;
SELECT count(*) FROM app.list_admin_audit_logs(10, NULL);
RESET ROLE;

ROLLBACK;
