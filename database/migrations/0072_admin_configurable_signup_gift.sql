-- 注册赠分由管理员配置；0 表示暂停赠分。
BEGIN;
SELECT pg_advisory_xact_lock(70420260972);

ALTER TABLE app.credit_system_policies
  DROP CONSTRAINT IF EXISTS credit_system_policies_amount_check,
  ADD CONSTRAINT credit_system_policies_amount_check CHECK (amount >= 0);

ALTER TABLE app.credit_system_policies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS credit_system_policies_api_access ON app.credit_system_policies;
CREATE POLICY credit_system_policies_api_access ON app.credit_system_policies
  FOR ALL USING (current_user IN ('qingyu_api','postgres'))
  WITH CHECK (current_user IN ('qingyu_api','postgres'));

REVOKE ALL ON TABLE app.credit_system_policies FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE ON TABLE app.credit_system_policies TO qingyu_api;

INSERT INTO app.schema_migrations(version,checksum)
VALUES ('0072_admin_configurable_signup_gift','admin-configurable-signup-gift-v1')
ON CONFLICT(version) DO NOTHING;
COMMIT;
