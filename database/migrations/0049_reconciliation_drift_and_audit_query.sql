-- 0049 修正对账视图 drift 公式 + 提供管理员审计日志查询入口。
-- 背景：0046 的 drift 把 reserve/commit 方向写反，且漏算了 grant 流水，
--       导致"发放 100 积分、尚未消费"这种本应差额为 0 的账户被误报成 100。
-- 守恒口径（quota_accounts 与 quota_ledger 必须自洽）：
--   available 账面 = granted - reserved - consumed
--   available 流水 = sum(grant) - sum(reserve) + sum(commit 抵消后为0)
--                  + sum(release) + sum(expire) + sum(refund) + sum(adjustment)
--   drift  = available 账面 - available 流水；正常应为 0。
BEGIN;
SELECT pg_advisory_xact_lock(70420260948);

CREATE OR REPLACE VIEW app.v_quota_reconciliation AS
SELECT a.id AS quota_account_id, a.workspace_id, a.quota_code,
       a.granted, a.reserved, a.consumed, a.available,
       COALESCE((SELECT sum(amount) FROM app.quota_ledger l WHERE l.account_id=a.id AND l.entry_type='reserve'),0)  AS ledger_reserved,
       COALESCE((SELECT sum(amount) FROM app.quota_ledger l WHERE l.account_id=a.id AND l.entry_type='commit'),0)   AS ledger_committed,
       COALESCE((SELECT sum(amount) FROM app.quota_ledger l WHERE l.entry_type IN ('release','expire') AND l.account_id=a.id),0) AS ledger_released,
       (a.granted - a.reserved - a.consumed
        - COALESCE((SELECT sum(CASE l.entry_type
                  WHEN 'grant' THEN l.amount
                  WHEN 'reserve' THEN -l.amount
                  WHEN 'commit' THEN 0
                  WHEN 'release' THEN l.amount
                  WHEN 'expire' THEN l.amount
                  WHEN 'refund' THEN l.amount
                  WHEN 'adjustment' THEN l.amount
                  ELSE 0 END)
              FROM app.quota_ledger l WHERE l.account_id=a.id),0)) AS drift
  FROM app.quota_accounts a;

-- 管理员审计日志查询（只查，不改不删；追加仍由 write_admin_audit 负责）。
CREATE OR REPLACE FUNCTION app.list_admin_audit_logs(p_limit integer DEFAULT 200, p_search text DEFAULT NULL)
RETURNS SETOF app.admin_audit_logs
LANGUAGE sql SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT * FROM app.admin_audit_logs
   WHERE (p_search IS NULL OR actor ILIKE '%'||p_search||'%' OR action ILIKE '%'||p_search||'%' OR summary ILIKE '%'||p_search||'%')
   ORDER BY created_at DESC
   LIMIT LEAST(1000, GREATEST(1, COALESCE(p_limit,200)));
$$;

REVOKE ALL ON FUNCTION app.list_admin_audit_logs(integer,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.list_admin_audit_logs(integer,text) TO qingyu_api;

INSERT INTO app.schema_migrations(version, checksum)
VALUES ('0049_reconciliation_drift_and_audit_query', 'reconciliation-drift-fix-v1')
ON CONFLICT (version) DO NOTHING;
COMMIT;
