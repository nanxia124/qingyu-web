-- 补齐资源归属约束；已执行的旧迁移保持不变。
BEGIN;
SELECT pg_advisory_xact_lock(70420260923);

ALTER TABLE app.file_objects ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE app.file_objects ADD UNIQUE (id, workspace_id);
ALTER TABLE app.generation_tasks ADD UNIQUE (id, workspace_id);
ALTER TABLE app.assets ADD UNIQUE (id, workspace_id);
ALTER TABLE app.assets ADD FOREIGN KEY (source_generation_id, workspace_id)
    REFERENCES app.generation_tasks(id, workspace_id);

ALTER TABLE app.generation_outputs ADD COLUMN workspace_id uuid;
UPDATE app.generation_outputs o SET workspace_id = t.workspace_id
    FROM app.generation_tasks t WHERE t.id = o.task_id;
ALTER TABLE app.generation_outputs ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE app.generation_outputs ADD FOREIGN KEY (task_id, workspace_id)
    REFERENCES app.generation_tasks(id, workspace_id);
ALTER TABLE app.generation_outputs ADD FOREIGN KEY (file_id, workspace_id)
    REFERENCES app.file_objects(id, workspace_id);
ALTER TABLE app.generation_outputs ADD FOREIGN KEY (thumbnail_file_id, workspace_id)
    REFERENCES app.file_objects(id, workspace_id);

ALTER TABLE app.asset_versions ADD COLUMN workspace_id uuid;
UPDATE app.asset_versions v SET workspace_id = a.workspace_id FROM app.assets a WHERE a.id = v.asset_id;
ALTER TABLE app.asset_versions ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE app.asset_versions ADD UNIQUE (id, workspace_id);
ALTER TABLE app.asset_versions ADD FOREIGN KEY (asset_id, workspace_id) REFERENCES app.assets(id, workspace_id);
ALTER TABLE app.asset_files ADD COLUMN workspace_id uuid;
UPDATE app.asset_files f SET workspace_id = v.workspace_id FROM app.asset_versions v WHERE v.id = f.asset_version_id;
ALTER TABLE app.asset_files ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE app.asset_files ADD FOREIGN KEY (asset_version_id, workspace_id) REFERENCES app.asset_versions(id, workspace_id);
ALTER TABLE app.asset_files ADD FOREIGN KEY (file_id, workspace_id) REFERENCES app.file_objects(id, workspace_id);

ALTER TABLE app.asset_comments ADD UNIQUE (id, asset_id);
ALTER TABLE app.asset_comments ADD FOREIGN KEY (parent_id, asset_id) REFERENCES app.asset_comments(id, asset_id);
ALTER TABLE app.asset_comments ADD CHECK (parent_id IS NULL OR parent_id <> id);
ALTER TABLE app.subscriptions ADD CHECK (current_period_end > current_period_start);
ALTER TABLE app.file_objects ADD CONSTRAINT file_objects_storage_identity
    UNIQUE NULLS NOT DISTINCT (storage_provider, bucket, object_key, storage_version_id);

CREATE INDEX asset_files_file_idx ON app.asset_files(file_id, workspace_id);
CREATE INDEX asset_versions_asset_idx ON app.asset_versions(asset_id, workspace_id);
CREATE INDEX generation_outputs_file_idx ON app.generation_outputs(file_id, workspace_id);
CREATE INDEX asset_comments_parent_idx ON app.asset_comments(parent_id, asset_id);

INSERT INTO app.schema_migrations(version, checksum) VALUES ('0004_resource_integrity', 'resource-integrity-v1');
COMMIT;
