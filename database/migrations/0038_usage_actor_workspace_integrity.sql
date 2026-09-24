-- 使用记录中的用户必须属于该工作空间，避免调用量被记到别人的空间。
BEGIN;
SELECT pg_advisory_xact_lock(70420260923);

CREATE OR REPLACE FUNCTION app.validate_usage_actor_workspace()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.user_id IS NULL THEN
        RETURN NEW;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM app.workspaces w
        WHERE w.id = NEW.workspace_id
          AND w.status = 'active'
          AND (
              (w.type = 'personal' AND w.owner_user_id = NEW.user_id)
              OR
              (w.type = 'team' AND EXISTS (
                  SELECT 1
                  FROM app.team_memberships tm
                  WHERE tm.team_id = w.team_id
                    AND tm.user_id = NEW.user_id
                    AND tm.status IN ('active', 'suspended')
              ))
          )
    ) THEN
        RAISE EXCEPTION '使用记录用户不属于目标工作空间';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS usage_records_actor_workspace_guard ON app.usage_records;
CREATE TRIGGER usage_records_actor_workspace_guard
    BEFORE INSERT OR UPDATE OF workspace_id, user_id
    ON app.usage_records
    FOR EACH ROW
    EXECUTE FUNCTION app.validate_usage_actor_workspace();

INSERT INTO app.schema_migrations(version, checksum)
VALUES ('0038_usage_actor_workspace_integrity', 'usage-actor-workspace-integrity-v1')
ON CONFLICT (version) DO NOTHING;
COMMIT;
