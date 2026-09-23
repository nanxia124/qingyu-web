-- 套餐版本必须属于订单或订阅当前引用的套餐，避免价格快照串套餐。
BEGIN;
SELECT pg_advisory_xact_lock(70420260923);

ALTER TABLE app.plan_versions ADD CONSTRAINT plan_versions_id_plan_key UNIQUE (id, plan_id);
ALTER TABLE app.subscriptions ADD CONSTRAINT subscriptions_plan_version_plan_fk
    FOREIGN KEY (plan_version_id, plan_id) REFERENCES app.plan_versions(id, plan_id) ON DELETE RESTRICT;
ALTER TABLE app.orders ADD CONSTRAINT orders_plan_version_plan_fk
    FOREIGN KEY (plan_version_id, plan_id) REFERENCES app.plan_versions(id, plan_id) ON DELETE RESTRICT;

INSERT INTO app.schema_migrations(version, checksum)
VALUES ('0017_plan_version_consistency', 'plan-version-consistency-v1')
ON CONFLICT (version) DO NOTHING;
COMMIT;
