-- Agent 可恢复执行、审批、工具调用、附件、提示词和插件版本。
BEGIN;
SELECT pg_advisory_xact_lock(70420260923);

ALTER TABLE app.agent_messages ADD CONSTRAINT agent_messages_id_workspace_key UNIQUE (id, workspace_id);

CREATE TABLE IF NOT EXISTS app.agent_turns (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    thread_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    turn_key varchar(200) NOT NULL,
    idempotency_key varchar(200) NOT NULL UNIQUE,
    status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','waiting_approval','succeeded','failed','cancelled','expired')),
    request_hash varchar(128) NOT NULL,
    model varchar(160),
    pricing_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
    lease_token uuid,
    lease_expires_at timestamptz,
    attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    error_code varchar(120),
    error_message text,
    started_at timestamptz,
    finished_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (thread_id, turn_key),
    UNIQUE (id, workspace_id),
    FOREIGN KEY (thread_id, workspace_id) REFERENCES app.agent_threads(id, workspace_id) ON DELETE CASCADE,
    CHECK ((status IN ('succeeded','failed','cancelled','expired') AND finished_at IS NOT NULL) OR status NOT IN ('succeeded','failed','cancelled','expired'))
);

CREATE TABLE IF NOT EXISTS app.agent_approvals (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    turn_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    request_key varchar(200) NOT NULL,
    action_type varchar(120) NOT NULL,
    input_hash varchar(128) NOT NULL,
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','denied','expired','cancelled')),
    requested_by uuid REFERENCES app.user_accounts(id) ON DELETE SET NULL,
    decided_by uuid REFERENCES app.user_accounts(id) ON DELETE SET NULL,
    expires_at timestamptz NOT NULL,
    decided_at timestamptz,
    decision_reason text,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (turn_id, request_key),
    UNIQUE (id, workspace_id),
    FOREIGN KEY (turn_id, workspace_id) REFERENCES app.agent_turns(id, workspace_id) ON DELETE CASCADE,
    CHECK ((status IN ('approved','denied','expired','cancelled') AND decided_at IS NOT NULL) OR status = 'pending')
);

CREATE TABLE IF NOT EXISTS app.agent_tool_calls (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    turn_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    call_key varchar(200) NOT NULL,
    tool_name varchar(160) NOT NULL,
    input_hash varchar(128) NOT NULL,
    status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','succeeded','failed','cancelled','unknown')),
    result jsonb,
    external_request_id varchar(200),
    started_at timestamptz,
    finished_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (turn_id, call_key),
    UNIQUE (id, workspace_id),
    FOREIGN KEY (turn_id, workspace_id) REFERENCES app.agent_turns(id, workspace_id)
);

CREATE TABLE IF NOT EXISTS app.agent_attachments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    file_id uuid NOT NULL,
    attachment_role varchar(64) NOT NULL DEFAULT 'input',
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (message_id, file_id),
    FOREIGN KEY (message_id, workspace_id) REFERENCES app.agent_messages(id, workspace_id) ON DELETE CASCADE,
    FOREIGN KEY (file_id, workspace_id) REFERENCES app.file_objects(id, workspace_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS app.prompt_sources (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid REFERENCES app.workspaces(id) ON DELETE RESTRICT,
    source_type varchar(40) NOT NULL CHECK (source_type IN ('built_in','url','file','manual')),
    source_uri text,
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled','error')),
    refresh_interval_seconds integer CHECK (refresh_interval_seconds IS NULL OR refresh_interval_seconds > 0),
    created_by uuid REFERENCES app.user_accounts(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app.prompt_templates (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid REFERENCES app.workspaces(id) ON DELETE RESTRICT,
    source_id uuid REFERENCES app.prompt_sources(id) ON DELETE SET NULL,
    template_key varchar(160) NOT NULL,
    title varchar(240) NOT NULL,
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('draft','active','archived')),
    created_by uuid REFERENCES app.user_accounts(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, template_key)
);

CREATE TABLE IF NOT EXISTS app.prompt_template_versions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id uuid NOT NULL REFERENCES app.prompt_templates(id) ON DELETE CASCADE,
    version integer NOT NULL CHECK (version > 0),
    body text NOT NULL,
    variables jsonb NOT NULL DEFAULT '[]'::jsonb,
    content_hash varchar(128) NOT NULL,
    created_by uuid REFERENCES app.user_accounts(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (template_id, version),
    UNIQUE (template_id, content_hash)
);

CREATE TABLE IF NOT EXISTS app.prompt_tags (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid REFERENCES app.workspaces(id) ON DELETE RESTRICT,
    name varchar(80) NOT NULL,
    UNIQUE (workspace_id, name)
);

CREATE TABLE IF NOT EXISTS app.prompt_template_tags (
    template_id uuid NOT NULL REFERENCES app.prompt_templates(id) ON DELETE CASCADE,
    tag_id uuid NOT NULL REFERENCES app.prompt_tags(id) ON DELETE CASCADE,
    PRIMARY KEY (template_id, tag_id)
);

CREATE TABLE IF NOT EXISTS app.plugins (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    plugin_key varchar(160) NOT NULL UNIQUE,
    display_name varchar(240) NOT NULL,
    source_type varchar(40) NOT NULL CHECK (source_type IN ('built_in','registry','git','url','local')),
    source_uri text,
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled','blocked')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app.plugin_versions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    plugin_id uuid NOT NULL REFERENCES app.plugins(id) ON DELETE CASCADE,
    version varchar(80) NOT NULL,
    manifest jsonb NOT NULL DEFAULT '{}'::jsonb,
    package_hash varchar(128),
    released_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (plugin_id, version),
    UNIQUE (id, plugin_id)
);

CREATE TABLE IF NOT EXISTS app.workspace_plugins (
    workspace_id uuid NOT NULL REFERENCES app.workspaces(id) ON DELETE RESTRICT,
    plugin_id uuid NOT NULL REFERENCES app.plugins(id) ON DELETE RESTRICT,
    plugin_version_id uuid REFERENCES app.plugin_versions(id) ON DELETE RESTRICT,
    status text NOT NULL DEFAULT 'enabled' CHECK (status IN ('enabled','disabled','pending','blocked')),
    config jsonb NOT NULL DEFAULT '{}'::jsonb,
    installed_by uuid REFERENCES app.user_accounts(id) ON DELETE SET NULL,
    installed_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (workspace_id, plugin_id),
    FOREIGN KEY (plugin_version_id, plugin_id) REFERENCES app.plugin_versions(id, plugin_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS agent_turns_workspace_idx ON app.agent_turns(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS agent_turns_lease_idx ON app.agent_turns(status, lease_expires_at);
CREATE INDEX IF NOT EXISTS agent_approvals_pending_idx ON app.agent_approvals(workspace_id, status, expires_at);
CREATE INDEX IF NOT EXISTS agent_tool_calls_turn_idx ON app.agent_tool_calls(turn_id, created_at);
CREATE INDEX IF NOT EXISTS prompt_templates_workspace_idx ON app.prompt_templates(workspace_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS workspace_plugins_workspace_idx ON app.workspace_plugins(workspace_id, status);

-- 新增工作空间表默认采用同一空间隔离规则；全局提示词（workspace_id IS NULL）由受控后端读取。
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['agent_turns','agent_approvals','agent_tool_calls','agent_attachments','workspace_plugins'] LOOP
    EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS workspace_isolation ON app.%I', t);
    IF t = 'agent_attachments' THEN
      EXECUTE 'CREATE POLICY workspace_isolation ON app.agent_attachments USING (app.has_workspace_access(workspace_id)) WITH CHECK (app.has_workspace_access(workspace_id))';
    ELSE
      EXECUTE format('CREATE POLICY workspace_isolation ON app.%I USING (app.has_workspace_access(workspace_id)) WITH CHECK (app.has_workspace_access(workspace_id))', t);
    END IF;
  END LOOP;
END $$;

INSERT INTO app.schema_migrations(version, checksum)
VALUES ('0011_agent_governance', 'agent-governance-v1')
ON CONFLICT (version) DO NOTHING;
COMMIT;
