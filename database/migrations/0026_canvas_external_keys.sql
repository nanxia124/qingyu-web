-- 给前端画布 ID 建立稳定的外部键，支持把浏览器中的画布快照同步到规范化表。
BEGIN;
SELECT pg_advisory_xact_lock(70420260923);

ALTER TABLE app.canvas_projects ADD COLUMN IF NOT EXISTS external_key varchar(160);
UPDATE app.canvas_projects SET external_key=id::text WHERE external_key IS NULL;
ALTER TABLE app.canvas_projects ALTER COLUMN external_key SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS canvas_projects_workspace_external_idx ON app.canvas_projects(workspace_id, external_key);

INSERT INTO app.schema_migrations(version, checksum)
VALUES ('0026_canvas_external_keys', 'canvas-external-keys-v1')
ON CONFLICT (version) DO NOTHING;
COMMIT;
