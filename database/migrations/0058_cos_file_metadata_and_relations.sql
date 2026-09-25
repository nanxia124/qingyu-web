-- 为 COS 文件增加分类和来源元数据，并补齐上传批次、生成输入、项目素材关系。
-- 历史文件的分类保持 NULL，待可信数据回填后再逐步要求新写入必填。
BEGIN;

ALTER TABLE app.file_objects
    ADD COLUMN media_type text,
    ADD COLUMN source_kind text,
    ADD COLUMN original_filename text,
    ADD COLUMN upload_batch_id uuid,
    ADD COLUMN source_file_id uuid,
    ADD COLUMN preview_variant text,
    ADD COLUMN width integer,
    ADD COLUMN height integer,
    ADD COLUMN duration_ms integer,
    ADD COLUMN write_idempotency_key varchar(160),
    ADD COLUMN retry_count integer NOT NULL DEFAULT 0,
    ADD COLUMN last_error_code varchar(120),
    ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE app.file_objects DROP CONSTRAINT IF EXISTS file_objects_status_check;
ALTER TABLE app.file_objects
    ADD CONSTRAINT file_objects_status_check
    CHECK (status IN ('pending','ready','failed','deleting','deleted')),
    ADD CONSTRAINT file_objects_media_type_check
    CHECK (media_type IS NULL OR media_type IN ('image','video','audio','text','document','other')),
    ADD CONSTRAINT file_objects_source_kind_check
    CHECK (source_kind IS NULL OR source_kind IN ('generated','reference_upload','manual_upload','edited','derived')),
    ADD CONSTRAINT file_objects_dimensions_check
    CHECK ((width IS NULL OR width > 0) AND (height IS NULL OR height > 0) AND (duration_ms IS NULL OR duration_ms >= 0)),
    ADD CONSTRAINT file_objects_retry_count_check CHECK (retry_count >= 0),
    ADD CONSTRAINT file_objects_source_fields_check CHECK (
        (source_kind IS NULL)
        OR (source_kind IN ('reference_upload','manual_upload') AND upload_batch_id IS NOT NULL AND source_file_id IS NULL AND preview_variant IS NULL)
        OR (source_kind = 'generated' AND upload_batch_id IS NULL AND source_file_id IS NULL AND preview_variant IS NULL)
        OR (source_kind = 'edited' AND upload_batch_id IS NULL AND source_file_id IS NOT NULL AND preview_variant IS NULL)
        OR (source_kind = 'derived' AND upload_batch_id IS NULL AND source_file_id IS NOT NULL AND preview_variant IS NOT NULL)
    );

CREATE TABLE app.upload_batches (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES app.workspaces(id) ON DELETE RESTRICT,
    created_by uuid REFERENCES app.user_accounts(id) ON DELETE SET NULL,
    idempotency_key varchar(160) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (id, workspace_id),
    UNIQUE (workspace_id, idempotency_key)
);

CREATE TABLE app.generation_inputs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES app.workspaces(id) ON DELETE RESTRICT,
    task_id uuid NOT NULL,
    file_id uuid NOT NULL,
    role text NOT NULL CHECK (role IN ('reference','attachment')),
    position integer NOT NULL CHECK (position >= 0),
    created_by uuid REFERENCES app.user_accounts(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (id, workspace_id),
    UNIQUE (task_id, role, position),
    FOREIGN KEY (task_id, workspace_id) REFERENCES app.generation_tasks(id, workspace_id) ON DELETE RESTRICT,
    FOREIGN KEY (file_id, workspace_id) REFERENCES app.file_objects(id, workspace_id) ON DELETE RESTRICT
);

ALTER TABLE app.asset_versions
    ADD CONSTRAINT asset_versions_id_asset_workspace_unique UNIQUE (id, asset_id, workspace_id);

CREATE TABLE app.canvas_project_assets (
    workspace_id uuid NOT NULL REFERENCES app.workspaces(id) ON DELETE RESTRICT,
    project_id uuid NOT NULL,
    asset_id uuid NOT NULL,
    asset_version_id uuid NOT NULL,
    added_by uuid REFERENCES app.user_accounts(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (project_id, asset_id),
    FOREIGN KEY (project_id, workspace_id) REFERENCES app.canvas_projects(id, workspace_id) ON DELETE CASCADE,
    FOREIGN KEY (asset_id, workspace_id) REFERENCES app.assets(id, workspace_id) ON DELETE RESTRICT,
    FOREIGN KEY (asset_version_id, asset_id, workspace_id)
        REFERENCES app.asset_versions(id, asset_id, workspace_id) ON DELETE RESTRICT
);

ALTER TABLE app.file_objects
    ADD CONSTRAINT file_objects_upload_batch_workspace_fk
        FOREIGN KEY (upload_batch_id, workspace_id) REFERENCES app.upload_batches(id, workspace_id) ON DELETE RESTRICT,
    ADD CONSTRAINT file_objects_source_file_workspace_fk
        FOREIGN KEY (source_file_id, workspace_id) REFERENCES app.file_objects(id, workspace_id) ON DELETE RESTRICT,
    ADD CONSTRAINT file_objects_not_self_source CHECK (source_file_id IS NULL OR source_file_id <> id);

CREATE OR REPLACE FUNCTION app.prevent_file_source_cycle()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.source_file_id IS NULL THEN
        RETURN NEW;
    END IF;

    IF EXISTS (
        WITH RECURSIVE source_chain(file_id, source_file_id, visited) AS (
            SELECT f.id, f.source_file_id, ARRAY[f.id]
            FROM app.file_objects f
            WHERE f.id = NEW.source_file_id AND f.workspace_id = NEW.workspace_id
            UNION ALL
            SELECT parent.id, parent.source_file_id, source_chain.visited || parent.id
            FROM source_chain
            JOIN app.file_objects parent
              ON parent.id = source_chain.source_file_id
             AND parent.workspace_id = NEW.workspace_id
            WHERE NOT parent.id = ANY(source_chain.visited)
        )
        SELECT 1 FROM source_chain WHERE file_id = NEW.id
    ) THEN
        RAISE EXCEPTION '文件来源不能形成循环' USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;
CREATE TRIGGER file_objects_source_cycle_guard
BEFORE INSERT OR UPDATE OF source_file_id, workspace_id ON app.file_objects
FOR EACH ROW EXECUTE FUNCTION app.prevent_file_source_cycle();

CREATE UNIQUE INDEX file_objects_write_idempotency_unique
    ON app.file_objects(workspace_id, write_idempotency_key)
    WHERE write_idempotency_key IS NOT NULL;
CREATE INDEX file_objects_media_source_status_created_idx
    ON app.file_objects(workspace_id, media_type, source_kind, status, created_at DESC);
CREATE INDEX file_objects_upload_batch_idx ON app.file_objects(upload_batch_id) WHERE upload_batch_id IS NOT NULL;
CREATE INDEX file_objects_source_file_idx ON app.file_objects(source_file_id) WHERE source_file_id IS NOT NULL;
CREATE INDEX generation_inputs_file_idx ON app.generation_inputs(file_id, workspace_id);
CREATE INDEX canvas_project_assets_asset_idx ON app.canvas_project_assets(asset_id, workspace_id);

ALTER TABLE app.upload_batches ENABLE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON app.upload_batches
    USING (app.has_workspace_access(workspace_id))
    WITH CHECK (app.has_workspace_access(workspace_id));
ALTER TABLE app.generation_inputs ENABLE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON app.generation_inputs
    USING (app.has_workspace_access(workspace_id))
    WITH CHECK (app.has_workspace_access(workspace_id));
ALTER TABLE app.canvas_project_assets ENABLE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON app.canvas_project_assets
    USING (app.has_workspace_access(workspace_id))
    WITH CHECK (app.has_workspace_access(workspace_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON
    app.upload_batches, app.generation_inputs, app.canvas_project_assets
TO qingyu_app;

INSERT INTO app.schema_migrations(version, checksum)
VALUES ('0058_cos_file_metadata_and_relations', 'cos-file-metadata-and-relations-v1')
ON CONFLICT (version) DO NOTHING;
COMMIT;
