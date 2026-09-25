-- 补齐编辑来源、画布节点固定版本和可租约执行的 COS 文件作业。
BEGIN;

ALTER TABLE app.file_objects ADD COLUMN edit_id uuid;
ALTER TABLE app.upload_sessions
    ADD CONSTRAINT upload_sessions_id_file_workspace_unique UNIQUE (id, file_id, workspace_id);
ALTER TABLE app.generation_outputs
    ADD CONSTRAINT generation_outputs_id_file_workspace_unique UNIQUE (id, file_id, workspace_id);
ALTER TABLE app.asset_files
    ADD CONSTRAINT asset_files_version_file_workspace_role_unique
        UNIQUE (asset_version_id, file_id, workspace_id, role);
ALTER TABLE app.canvas_nodes
    ADD CONSTRAINT canvas_nodes_id_project_workspace_unique UNIQUE (id, project_id, workspace_id);

CREATE TABLE app.content_edits (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES app.workspaces(id) ON DELETE RESTRICT,
    created_by uuid REFERENCES app.user_accounts(id) ON DELETE SET NULL,
    idempotency_key varchar(160) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (length(btrim(idempotency_key)) > 0),
    UNIQUE (id, workspace_id),
    UNIQUE (workspace_id, idempotency_key)
);

ALTER TABLE app.file_objects
    ADD CONSTRAINT file_objects_edit_workspace_fk
        FOREIGN KEY (edit_id, workspace_id) REFERENCES app.content_edits(id, workspace_id) ON DELETE RESTRICT,
    ADD CONSTRAINT file_objects_edited_requires_edit_check
        CHECK (source_kind IS DISTINCT FROM 'edited' OR (edit_id IS NOT NULL AND source_file_id IS NOT NULL)) NOT VALID;

CREATE TABLE app.content_edit_inputs (
    workspace_id uuid NOT NULL REFERENCES app.workspaces(id) ON DELETE RESTRICT,
    edit_id uuid NOT NULL,
    file_id uuid NOT NULL,
    role text NOT NULL CHECK (role IN ('base','reference','attachment')),
    position integer NOT NULL CHECK (position >= 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (edit_id, role, position),
    FOREIGN KEY (edit_id, workspace_id) REFERENCES app.content_edits(id, workspace_id) ON DELETE RESTRICT,
    FOREIGN KEY (file_id, workspace_id) REFERENCES app.file_objects(id, workspace_id) ON DELETE RESTRICT
);
CREATE INDEX content_edit_inputs_file_idx ON app.content_edit_inputs(file_id, workspace_id);

CREATE TABLE app.canvas_node_asset_uses (
    workspace_id uuid NOT NULL REFERENCES app.workspaces(id) ON DELETE RESTRICT,
    project_id uuid NOT NULL,
    node_id uuid NOT NULL,
    slot_key varchar(160) NOT NULL CHECK (length(btrim(slot_key)) > 0),
    asset_id uuid NOT NULL,
    asset_version_id uuid NOT NULL,
    file_id uuid NOT NULL,
    file_role varchar(32) NOT NULL CHECK (file_role IN ('source','preview','thumbnail','attachment')),
    created_by uuid REFERENCES app.user_accounts(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (node_id, slot_key),
    FOREIGN KEY (node_id, project_id, workspace_id)
        REFERENCES app.canvas_nodes(id, project_id, workspace_id) ON DELETE CASCADE,
    FOREIGN KEY (asset_id, workspace_id) REFERENCES app.assets(id, workspace_id) ON DELETE RESTRICT,
    FOREIGN KEY (asset_version_id, asset_id, workspace_id)
        REFERENCES app.asset_versions(id, asset_id, workspace_id) ON DELETE RESTRICT,
    FOREIGN KEY (file_id, workspace_id) REFERENCES app.file_objects(id, workspace_id) ON DELETE RESTRICT,
    FOREIGN KEY (asset_version_id, file_id, workspace_id, file_role)
        REFERENCES app.asset_files(asset_version_id, file_id, workspace_id, role) ON DELETE RESTRICT
);
CREATE INDEX canvas_node_asset_uses_project_idx ON app.canvas_node_asset_uses(project_id, workspace_id);
CREATE INDEX canvas_node_asset_uses_asset_version_idx
    ON app.canvas_node_asset_uses(asset_id, asset_version_id, workspace_id);
CREATE INDEX canvas_node_asset_uses_file_idx ON app.canvas_node_asset_uses(file_id, workspace_id);

CREATE TABLE app.file_jobs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES app.workspaces(id) ON DELETE RESTRICT,
    file_id uuid NOT NULL,
    job_kind text NOT NULL CHECK (job_kind IN ('persist','verify','inspect','preview','delete','abort_upload')),
    idempotency_key varchar(160) NOT NULL,
    status text NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued','running','retry_wait','succeeded','needs_attention','cancelled')),
    attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    next_run_at timestamptz NOT NULL DEFAULT now(),
    lease_owner varchar(200),
    lease_until timestamptz,
    lease_version bigint NOT NULL DEFAULT 0 CHECK (lease_version >= 0),
    last_error_code varchar(120),
    upload_session_id uuid,
    generation_output_id uuid,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (id, workspace_id),
    UNIQUE (workspace_id, idempotency_key),
    FOREIGN KEY (file_id, workspace_id) REFERENCES app.file_objects(id, workspace_id) ON DELETE RESTRICT,
    FOREIGN KEY (upload_session_id, file_id, workspace_id)
        REFERENCES app.upload_sessions(id, file_id, workspace_id) ON DELETE RESTRICT,
    FOREIGN KEY (generation_output_id, file_id, workspace_id)
        REFERENCES app.generation_outputs(id, file_id, workspace_id) ON DELETE RESTRICT,
    CHECK (
        num_nonnulls(upload_session_id, generation_output_id) <= 1
        AND (job_kind <> 'abort_upload' OR upload_session_id IS NOT NULL)
        AND (job_kind <> 'persist' OR num_nonnulls(upload_session_id, generation_output_id) = 1)
    ),
    CHECK (
        (status = 'running' AND lease_owner IS NOT NULL AND lease_until IS NOT NULL AND lease_version > 0)
        OR (status <> 'running' AND lease_owner IS NULL AND lease_until IS NULL)
    ),
    CHECK (lease_owner IS NULL OR length(btrim(lease_owner)) > 0),
    CHECK (length(btrim(idempotency_key)) > 0)
);
CREATE INDEX file_jobs_due_idx ON app.file_jobs(status, next_run_at, created_at)
    WHERE status IN ('queued','retry_wait');
CREATE INDEX file_jobs_lease_expiry_idx ON app.file_jobs(lease_until)
    WHERE status = 'running';
CREATE INDEX file_jobs_file_idx ON app.file_jobs(file_id, workspace_id, created_at DESC);

CREATE OR REPLACE FUNCTION app.guard_file_job_lease_and_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_lease_owner text;
    v_lease_version bigint;
BEGIN
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
       OR NEW.file_id IS DISTINCT FROM OLD.file_id
       OR NEW.job_kind IS DISTINCT FROM OLD.job_kind
       OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
       OR NEW.upload_session_id IS DISTINCT FROM OLD.upload_session_id
       OR NEW.generation_output_id IS DISTINCT FROM OLD.generation_output_id THEN
        RAISE EXCEPTION '文件作业的身份和输入不可修改' USING ERRCODE = '23514';
    END IF;

    IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
        (OLD.status = 'queued' AND NEW.status IN ('running','cancelled'))
        OR (OLD.status = 'retry_wait' AND NEW.status IN ('running','cancelled'))
        OR (OLD.status = 'running' AND NEW.status IN ('retry_wait','succeeded','needs_attention','cancelled'))
        OR (OLD.status = 'needs_attention' AND NEW.status IN ('queued','cancelled'))
    ) THEN
        RAISE EXCEPTION '文件作业状态不能从 % 变成 %', OLD.status, NEW.status USING ERRCODE = '23514';
    END IF;

    IF OLD.status IN ('queued','retry_wait') AND NEW.status = 'running' THEN
        IF NEW.lease_version <> OLD.lease_version + 1 OR NEW.attempt_count <> OLD.attempt_count + 1
           OR NEW.lease_until <= clock_timestamp() THEN
            RAISE EXCEPTION '领取文件作业时必须递增租约版本和尝试次数' USING ERRCODE = '23514';
        END IF;
    ELSIF OLD.status = 'running' AND NEW.status = 'running' THEN
        IF OLD.lease_until > clock_timestamp() OR NEW.lease_version <> OLD.lease_version + 1
           OR NEW.attempt_count <> OLD.attempt_count + 1 OR NEW.lease_until <= clock_timestamp() THEN
            RAISE EXCEPTION '只有过期租约可以被新执行器接管' USING ERRCODE = '23514';
        END IF;
    ELSIF OLD.status = 'running' AND NEW.status <> 'running' THEN
        v_lease_owner := NULLIF(current_setting('app.file_job_lease_owner', true), '');
        v_lease_version := NULLIF(current_setting('app.file_job_lease_version', true), '')::bigint;
        IF OLD.lease_until <= clock_timestamp() OR v_lease_owner IS DISTINCT FROM OLD.lease_owner
           OR v_lease_version IS DISTINCT FROM OLD.lease_version THEN
            RAISE EXCEPTION '文件作业租约已过期或版本不匹配' USING ERRCODE = '23514';
        END IF;
    END IF;

    NEW.updated_at := now();
    RETURN NEW;
END;
$$;
CREATE TRIGGER file_jobs_lease_transition_guard
BEFORE UPDATE ON app.file_jobs
FOR EACH ROW EXECUTE FUNCTION app.guard_file_job_lease_and_transition();

ALTER TABLE app.content_edits ENABLE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON app.content_edits
    USING (app.has_workspace_access(workspace_id)) WITH CHECK (app.has_workspace_access(workspace_id));
ALTER TABLE app.content_edit_inputs ENABLE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON app.content_edit_inputs
    USING (app.has_workspace_access(workspace_id)) WITH CHECK (app.has_workspace_access(workspace_id));
ALTER TABLE app.canvas_node_asset_uses ENABLE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON app.canvas_node_asset_uses
    USING (app.has_workspace_access(workspace_id)) WITH CHECK (app.has_workspace_access(workspace_id));
ALTER TABLE app.file_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON app.file_jobs
    USING (app.has_workspace_access(workspace_id)) WITH CHECK (app.has_workspace_access(workspace_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON
    app.content_edits, app.content_edit_inputs, app.canvas_node_asset_uses, app.file_jobs
TO qingyu_app;

INSERT INTO app.schema_migrations(version, checksum)
VALUES ('0061_content_edits_node_assets_and_file_jobs', 'content-edits-node-assets-file-jobs-v1')
ON CONFLICT (version) DO NOTHING;
COMMIT;
