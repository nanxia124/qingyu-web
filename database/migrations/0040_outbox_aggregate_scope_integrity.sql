-- 实时同步事件必须和实际聚合对象属于同一工作空间。
BEGIN;
SELECT pg_advisory_xact_lock(70420260923);

CREATE OR REPLACE FUNCTION app.validate_outbox_aggregate_scope()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.aggregate_type = 'team' THEN
        IF NEW.workspace_id IS NULL OR NOT EXISTS (
            SELECT 1 FROM app.teams t
            JOIN app.workspaces w ON w.team_id = t.id
            WHERE t.id = NEW.aggregate_id AND w.id = NEW.workspace_id
        ) THEN
            RAISE EXCEPTION '团队事件和工作空间不一致';
        END IF;
    ELSIF NEW.aggregate_type = 'canvas_project' THEN
        IF NEW.workspace_id IS NULL OR NOT EXISTS (
            SELECT 1 FROM app.canvas_projects p
            WHERE p.id = NEW.aggregate_id AND p.workspace_id = NEW.workspace_id
        ) THEN
            RAISE EXCEPTION '画布事件和工作空间不一致';
        END IF;
    ELSIF NEW.aggregate_type = 'asset' THEN
        IF NEW.workspace_id IS NULL OR NOT EXISTS (
            SELECT 1 FROM app.assets a
            WHERE a.id = NEW.aggregate_id AND a.workspace_id = NEW.workspace_id
        ) THEN
            RAISE EXCEPTION '资产事件和工作空间不一致';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS outbox_aggregate_scope_guard ON app.outbox_events;
CREATE TRIGGER outbox_aggregate_scope_guard
    BEFORE INSERT OR UPDATE OF aggregate_type, aggregate_id, workspace_id
    ON app.outbox_events
    FOR EACH ROW
    EXECUTE FUNCTION app.validate_outbox_aggregate_scope();

INSERT INTO app.schema_migrations(version, checksum)
VALUES ('0040_outbox_aggregate_scope_integrity', 'outbox-aggregate-scope-integrity-v1')
ON CONFLICT (version) DO NOTHING;
COMMIT;
