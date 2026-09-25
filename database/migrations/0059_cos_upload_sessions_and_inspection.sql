-- 记录 COS 分片上传会话，并将物理保存、文件检查和文字完整度分开表达。
BEGIN;

ALTER TABLE app.file_objects
    ADD COLUMN inspection_status text NOT NULL DEFAULT 'pending',
    ADD COLUMN completeness text;

ALTER TABLE app.file_objects
    ADD CONSTRAINT file_objects_inspection_status_check
        CHECK (inspection_status IN ('pending','approved','rejected','error')),
    ADD CONSTRAINT file_objects_text_completeness_check
        CHECK (
            (media_type = 'text' AND completeness IS NOT NULL AND completeness IN ('complete','partial'))
            OR (media_type IS DISTINCT FROM 'text' AND completeness IS NULL)
        );

CREATE TABLE app.upload_sessions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES app.workspaces(id) ON DELETE RESTRICT,
    file_id uuid NOT NULL,
    attempt_no integer NOT NULL CHECK (attempt_no > 0),
    provider_upload_id text,
    status text NOT NULL DEFAULT 'initiated'
        CHECK (status IN ('initiated','uploading','completing','completed','aborting','aborted','failed')),
    expires_at timestamptz NOT NULL,
    last_error_code varchar(120),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (id, workspace_id),
    UNIQUE (file_id, attempt_no),
    FOREIGN KEY (file_id, workspace_id)
        REFERENCES app.file_objects(id, workspace_id) ON DELETE RESTRICT,
    CHECK (expires_at > created_at)
);

CREATE UNIQUE INDEX upload_sessions_one_active_per_file
    ON app.upload_sessions(file_id)
    WHERE status IN ('initiated','uploading','completing','aborting');
CREATE INDEX upload_sessions_expiry_idx
    ON app.upload_sessions(status, expires_at)
    WHERE status IN ('initiated','uploading','completing','aborting');
CREATE INDEX upload_sessions_workspace_file_idx
    ON app.upload_sessions(workspace_id, file_id, created_at DESC);

CREATE TABLE app.upload_session_parts (
    session_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    part_number integer NOT NULL CHECK (part_number > 0),
    etag text NOT NULL CHECK (length(etag) > 0),
    size_bytes bigint NOT NULL CHECK (size_bytes > 0),
    checksum varchar(128),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (session_id, part_number),
    FOREIGN KEY (session_id, workspace_id)
        REFERENCES app.upload_sessions(id, workspace_id) ON DELETE RESTRICT
);
CREATE INDEX upload_session_parts_workspace_session_idx
    ON app.upload_session_parts(workspace_id, session_id);

CREATE OR REPLACE FUNCTION app.guard_upload_session_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
       OR NEW.file_id IS DISTINCT FROM OLD.file_id
       OR NEW.attempt_no IS DISTINCT FROM OLD.attempt_no THEN
        RAISE EXCEPTION '上传会话归属和尝试编号不可修改' USING ERRCODE = '23514';
    END IF;

    IF NEW.provider_upload_id IS DISTINCT FROM OLD.provider_upload_id
       AND OLD.provider_upload_id IS NOT NULL THEN
        RAISE EXCEPTION '上传会话不能更换 COS 上传编号' USING ERRCODE = '23514';
    END IF;

    IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
        (OLD.status = 'initiated' AND NEW.status IN ('uploading','completing','aborting','failed'))
        OR (OLD.status = 'uploading' AND NEW.status IN ('completing','aborting','failed'))
        OR (OLD.status = 'completing' AND NEW.status IN ('completed','aborting','failed'))
        OR (OLD.status = 'aborting' AND NEW.status IN ('aborted','failed'))
    ) THEN
        RAISE EXCEPTION '上传会话状态不能从 % 变成 %', OLD.status, NEW.status USING ERRCODE = '23514';
    END IF;

    NEW.updated_at := now();
    RETURN NEW;
END;
$$;
CREATE TRIGGER upload_sessions_transition_guard
BEFORE UPDATE ON app.upload_sessions
FOR EACH ROW EXECUTE FUNCTION app.guard_upload_session_transition();

CREATE OR REPLACE FUNCTION app.guard_upload_session_part_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_session_id uuid;
    v_workspace_id uuid;
    v_status text;
BEGIN
    v_session_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.session_id ELSE NEW.session_id END;
    v_workspace_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.workspace_id ELSE NEW.workspace_id END;

    SELECT status INTO v_status
    FROM app.upload_sessions
    WHERE id = v_session_id AND workspace_id = v_workspace_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION '上传会话不存在' USING ERRCODE = '23503';
    END IF;

    IF TG_OP = 'DELETE' THEN
        IF v_status NOT IN ('aborted','failed') THEN
            RAISE EXCEPTION '只能清理已中止或失败会话的分片记录' USING ERRCODE = '23514';
        END IF;
        RETURN OLD;
    END IF;

    IF v_status <> 'uploading' THEN
        RAISE EXCEPTION '只有上传中的会话可以登记或更新分片' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'UPDATE' AND (NEW.session_id, NEW.workspace_id, NEW.part_number)
        IS DISTINCT FROM (OLD.session_id, OLD.workspace_id, OLD.part_number) THEN
        RAISE EXCEPTION '分片所属会话和编号不可修改' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER upload_session_parts_write_guard
BEFORE INSERT OR UPDATE OR DELETE ON app.upload_session_parts
FOR EACH ROW EXECUTE FUNCTION app.guard_upload_session_part_write();

ALTER TABLE app.upload_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON app.upload_sessions
    USING (app.has_workspace_access(workspace_id))
    WITH CHECK (app.has_workspace_access(workspace_id));
ALTER TABLE app.upload_session_parts ENABLE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON app.upload_session_parts
    USING (app.has_workspace_access(workspace_id))
    WITH CHECK (app.has_workspace_access(workspace_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON app.upload_sessions, app.upload_session_parts TO qingyu_app;

INSERT INTO app.schema_migrations(version, checksum)
VALUES ('0059_cos_upload_sessions_and_inspection', 'cos-upload-sessions-and-inspection-v1')
ON CONFLICT (version) DO NOTHING;
COMMIT;
