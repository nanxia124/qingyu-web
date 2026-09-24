-- 把 AI 调用事实和额度预占绑定，避免调用成功但额度不扣，或重复请求重复扣额度。
BEGIN;
SELECT pg_advisory_xact_lock(70420260923);

ALTER TABLE app.usage_records
    ADD COLUMN IF NOT EXISTS quota_reservation_id uuid;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'usage_records_quota_reservation_fk'
          AND conrelid = 'app.usage_records'::regclass
    ) THEN
        ALTER TABLE app.usage_records
            ADD CONSTRAINT usage_records_quota_reservation_fk
            FOREIGN KEY (quota_reservation_id)
            REFERENCES app.quota_reservations(id)
            ON DELETE RESTRICT;
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS usage_records_quota_reservation_idx
    ON app.usage_records(quota_reservation_id)
    WHERE quota_reservation_id IS NOT NULL;

-- API 运行账号只获得执行受控函数的权限；表的直接访问仍由后续角色收敛工作处理。
GRANT EXECUTE ON FUNCTION app.current_user_id() TO qingyu_api;
GRANT EXECUTE ON FUNCTION app.has_workspace_access(uuid) TO qingyu_api;
GRANT EXECUTE ON FUNCTION app.reserve_quota(uuid,varchar,numeric,varchar,timestamptz) TO qingyu_api;
GRANT EXECUTE ON FUNCTION app.settle_quota(uuid,varchar) TO qingyu_api;
GRANT EXECUTE ON FUNCTION app.release_quota(uuid,varchar) TO qingyu_api;

INSERT INTO app.schema_migrations(version, checksum)
VALUES ('0028_usage_quota_link', 'usage-quota-link-v1')
ON CONFLICT (version) DO NOTHING;
COMMIT;
