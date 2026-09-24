-- 强制使用记录与额度预占保持同一工作空间；免费额度还必须属于同一用户。
BEGIN;
SELECT pg_advisory_xact_lock(70420260923);

-- 让外键同时比较 id 和 workspace_id，避免只凭一个 UUID 关联到别的空间。
ALTER TABLE app.daily_usage_reservations
    ADD CONSTRAINT daily_usage_reservations_id_workspace_key UNIQUE (id, workspace_id);

ALTER TABLE app.usage_records
    ADD CONSTRAINT usage_records_quota_reservation_scope_fk
    FOREIGN KEY (quota_reservation_id, workspace_id)
    REFERENCES app.quota_reservations(id, workspace_id)
    ON DELETE RESTRICT;

ALTER TABLE app.usage_records
    ADD CONSTRAINT usage_records_daily_reservation_scope_fk
    FOREIGN KEY (daily_reservation_id, workspace_id)
    REFERENCES app.daily_usage_reservations(id, workspace_id)
    ON DELETE RESTRICT;

CREATE OR REPLACE FUNCTION app.validate_usage_reservation_scope()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.quota_reservation_id IS NOT NULL AND NEW.daily_reservation_id IS NOT NULL THEN
        RAISE EXCEPTION '一次使用记录不能同时关联付费额度和每日免费额度';
    END IF;

    IF NEW.daily_reservation_id IS NOT NULL
       AND NEW.user_id IS NULL THEN
        RAISE EXCEPTION '每日免费额度使用记录必须绑定用户';
    END IF;

    IF NEW.daily_reservation_id IS NOT NULL
       AND NOT EXISTS (
           SELECT 1
           FROM app.daily_usage_reservations r
           WHERE r.id = NEW.daily_reservation_id
             AND r.workspace_id = NEW.workspace_id
             AND r.user_id = NEW.user_id
       ) THEN
        RAISE EXCEPTION '每日免费额度预占与使用记录的用户或工作空间不一致';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS usage_records_reservation_scope_guard ON app.usage_records;
CREATE TRIGGER usage_records_reservation_scope_guard
    BEFORE INSERT OR UPDATE OF workspace_id, user_id, quota_reservation_id, daily_reservation_id
    ON app.usage_records
    FOR EACH ROW
    EXECUTE FUNCTION app.validate_usage_reservation_scope();

INSERT INTO app.schema_migrations(version, checksum)
VALUES ('0037_usage_reservation_scope_integrity', 'usage-reservation-scope-integrity-v1')
ON CONFLICT (version) DO NOTHING;
COMMIT;
