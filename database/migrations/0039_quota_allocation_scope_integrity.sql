-- 完善备用额度分配表的空间归属，防止以后启用时发生跨空间分配。
BEGIN;
SELECT pg_advisory_xact_lock(70420260923);

ALTER TABLE app.quota_grants
    ADD CONSTRAINT quota_grants_id_workspace_key UNIQUE (id, workspace_id);
ALTER TABLE app.usage_records
    ADD CONSTRAINT usage_records_id_workspace_key UNIQUE (id, workspace_id);

ALTER TABLE app.quota_allocations
    ADD COLUMN workspace_id uuid;

UPDATE app.quota_allocations a
SET workspace_id = g.workspace_id
FROM app.quota_grants g
WHERE g.id = a.grant_id
  AND a.workspace_id IS NULL;

ALTER TABLE app.quota_allocations
    ALTER COLUMN workspace_id SET NOT NULL,
    ADD CONSTRAINT quota_allocations_workspace_fk
        FOREIGN KEY (workspace_id) REFERENCES app.workspaces(id) ON DELETE RESTRICT,
    ADD CONSTRAINT quota_allocations_grant_scope_fk
        FOREIGN KEY (grant_id, workspace_id)
        REFERENCES app.quota_grants(id, workspace_id) ON DELETE RESTRICT,
    ADD CONSTRAINT quota_allocations_usage_scope_fk
        FOREIGN KEY (usage_record_id, workspace_id)
        REFERENCES app.usage_records(id, workspace_id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS quota_allocations_workspace_idx
    ON app.quota_allocations(workspace_id, created_at DESC);

ALTER TABLE app.quota_allocations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS workspace_isolation ON app.quota_allocations;
CREATE POLICY workspace_isolation ON app.quota_allocations
    USING (app.has_workspace_access(workspace_id))
    WITH CHECK (app.has_workspace_access(workspace_id));

INSERT INTO app.schema_migrations(version, checksum)
VALUES ('0039_quota_allocation_scope_integrity', 'quota-allocation-scope-integrity-v1')
ON CONFLICT (version) DO NOTHING;
COMMIT;
