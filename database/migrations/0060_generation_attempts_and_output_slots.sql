-- 为现有生成任务补齐单次调用记录与稳定输出槽位，不另建供应商任务体系。
BEGIN;

ALTER TABLE app.generation_tasks
    ADD COLUMN requested_output_count integer,
    ADD CONSTRAINT generation_tasks_requested_output_count_check
        CHECK (requested_output_count IS NULL OR requested_output_count >= 0);

CREATE TABLE app.generation_attempts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES app.workspaces(id) ON DELETE RESTRICT,
    task_id uuid NOT NULL,
    attempt_no integer NOT NULL CHECK (attempt_no > 0),
    provider varchar(80),
    provider_task_id varchar(200),
    returned_output_count integer CHECK (returned_output_count IS NULL OR returned_output_count >= 0),
    response_complete boolean NOT NULL DEFAULT false,
    started_at timestamptz NOT NULL DEFAULT now(),
    finished_at timestamptz,
    error_code varchar(120),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (id, workspace_id),
    UNIQUE (id, task_id, workspace_id),
    UNIQUE (task_id, attempt_no),
    FOREIGN KEY (task_id, workspace_id)
        REFERENCES app.generation_tasks(id, workspace_id) ON DELETE RESTRICT,
    CHECK (finished_at IS NULL OR finished_at >= started_at),
    CHECK (NOT response_complete OR (returned_output_count IS NOT NULL AND returned_output_count >= 0))
);
CREATE UNIQUE INDEX generation_attempts_provider_task_unique
    ON app.generation_attempts(provider, provider_task_id)
    WHERE provider IS NOT NULL AND provider_task_id IS NOT NULL;
CREATE INDEX generation_attempts_task_idx
    ON app.generation_attempts(task_id, attempt_no DESC);

ALTER TABLE app.generation_outputs
    ADD COLUMN attempt_id uuid,
    ADD COLUMN output_index integer,
    ADD COLUMN provider_output_id varchar(200),
    ADD COLUMN availability text,
    ADD CONSTRAINT generation_outputs_attempt_workspace_fk
        FOREIGN KEY (attempt_id, task_id, workspace_id)
        REFERENCES app.generation_attempts(id, task_id, workspace_id) ON DELETE RESTRICT,
    ADD CONSTRAINT generation_outputs_slot_fields_check
        CHECK (
            (attempt_id IS NULL AND output_index IS NULL AND availability IS NULL)
            OR
            (attempt_id IS NOT NULL AND output_index IS NOT NULL AND output_index >= 0
                AND availability IS NOT NULL AND availability IN ('awaiting','available','unavailable'))
        );

CREATE UNIQUE INDEX generation_outputs_attempt_slot_unique
    ON app.generation_outputs(attempt_id, output_index)
    WHERE attempt_id IS NOT NULL;
CREATE UNIQUE INDEX generation_outputs_attempt_provider_output_unique
    ON app.generation_outputs(attempt_id, provider_output_id)
    WHERE attempt_id IS NOT NULL AND provider_output_id IS NOT NULL;
CREATE UNIQUE INDEX generation_outputs_new_task_file_unique
    ON app.generation_outputs(task_id, file_id)
    WHERE attempt_id IS NOT NULL AND file_id IS NOT NULL;
CREATE INDEX generation_outputs_attempt_availability_idx
    ON app.generation_outputs(attempt_id, availability, output_index)
    WHERE attempt_id IS NOT NULL;

ALTER TABLE app.generation_attempts ENABLE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON app.generation_attempts
    USING (app.has_workspace_access(workspace_id))
    WITH CHECK (app.has_workspace_access(workspace_id));
GRANT SELECT, INSERT, UPDATE, DELETE ON app.generation_attempts TO qingyu_app;

INSERT INTO app.schema_migrations(version, checksum)
VALUES ('0060_generation_attempts_and_output_slots', 'generation-attempts-and-output-slots-v1')
ON CONFLICT (version) DO NOTHING;
COMMIT;
