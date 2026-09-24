-- 所有调用结束路径统一补齐完成时间和实际延迟，避免后台核对遗漏。
BEGIN;
SELECT pg_advisory_xact_lock(70420260923);

CREATE OR REPLACE FUNCTION app.fill_usage_completion_metrics()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.result IN ('committed', 'released', 'failed', 'unknown')
       AND (TG_OP = 'INSERT' OR OLD.result IS DISTINCT FROM NEW.result)
       AND NEW.completed_at IS NULL THEN
        NEW.completed_at := now();
    END IF;
    IF NEW.completed_at IS NOT NULL AND NEW.latency_ms IS NULL THEN
        NEW.latency_ms := greatest(0, floor(extract(epoch from (NEW.completed_at - NEW.occurred_at)) * 1000))::int;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS usage_completion_metrics_fill ON app.usage_records;
CREATE TRIGGER usage_completion_metrics_fill
    BEFORE INSERT OR UPDATE OF result, completed_at, latency_ms ON app.usage_records
    FOR EACH ROW EXECUTE FUNCTION app.fill_usage_completion_metrics();

REVOKE ALL ON FUNCTION app.fill_usage_completion_metrics() FROM PUBLIC, qingyu_app;
GRANT EXECUTE ON FUNCTION app.fill_usage_completion_metrics() TO qingyu_api;

INSERT INTO app.schema_migrations(version, checksum)
VALUES ('0053_usage_completion_guard', 'usage-completion-guard-v1')
ON CONFLICT (version) DO NOTHING;
COMMIT;
