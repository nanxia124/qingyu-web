-- 画布与 Agent 持久化迁移
BEGIN;

CREATE TABLE IF NOT EXISTS app.canvas_projects (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES app.workspaces(id) ON DELETE RESTRICT,
    created_by uuid REFERENCES app.user_accounts(id) ON DELETE SET NULL,
    title varchar(240) NOT NULL,
    background_mode varchar(32) NOT NULL DEFAULT 'lines',
    show_image_info boolean NOT NULL DEFAULT false,
    viewport jsonb NOT NULL DEFAULT '{"x":0,"y":0,"k":1}'::jsonb,
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived','deleted')),
    version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz,
    UNIQUE (id, workspace_id)
);

CREATE TABLE IF NOT EXISTS app.canvas_nodes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    node_key varchar(160) NOT NULL,
    node_type varchar(120) NOT NULL,
    title varchar(240) NOT NULL,
    position jsonb NOT NULL,
    width numeric(12,2) NOT NULL CHECK (width > 0),
    height numeric(12,2) NOT NULL CHECK (height > 0),
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (project_id, node_key),
    UNIQUE (id, workspace_id),
    FOREIGN KEY (project_id, workspace_id) REFERENCES app.canvas_projects(id, workspace_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS app.canvas_connections (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    connection_key varchar(160) NOT NULL,
    from_node_id uuid NOT NULL,
    to_node_id uuid NOT NULL,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (project_id, connection_key),
    FOREIGN KEY (project_id, workspace_id) REFERENCES app.canvas_projects(id, workspace_id) ON DELETE CASCADE,
    FOREIGN KEY (from_node_id, workspace_id) REFERENCES app.canvas_nodes(id, workspace_id) ON DELETE RESTRICT,
    FOREIGN KEY (to_node_id, workspace_id) REFERENCES app.canvas_nodes(id, workspace_id) ON DELETE RESTRICT,
    CHECK (from_node_id <> to_node_id)
);

CREATE TABLE IF NOT EXISTS app.canvas_chat_sessions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    session_key varchar(160) NOT NULL,
    title varchar(240) NOT NULL,
    created_by uuid REFERENCES app.user_accounts(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (project_id, session_key),
    UNIQUE (id, workspace_id),
    FOREIGN KEY (project_id, workspace_id) REFERENCES app.canvas_projects(id, workspace_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS app.canvas_chat_messages (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    message_key varchar(160) NOT NULL,
    role varchar(32) NOT NULL CHECK (role IN ('user','assistant','system','tool','error')),
    content text NOT NULL,
    detail jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (session_id, message_key),
    FOREIGN KEY (session_id, workspace_id) REFERENCES app.canvas_chat_sessions(id, workspace_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS app.agent_threads (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES app.workspaces(id) ON DELETE RESTRICT,
    user_id uuid REFERENCES app.user_accounts(id) ON DELETE SET NULL,
    external_thread_id varchar(200),
    title varchar(240),
    workspace_path text,
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived','deleted')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (id, workspace_id),
    UNIQUE (workspace_id, external_thread_id)
);

CREATE TABLE IF NOT EXISTS app.agent_messages (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    thread_id uuid NOT NULL REFERENCES app.agent_threads(id) ON DELETE CASCADE,
    workspace_id uuid NOT NULL,
    external_item_id varchar(200),
    role varchar(32) NOT NULL CHECK (role IN ('user','assistant','system','tool','error')),
    content text NOT NULL,
    attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
    canvas_references jsonb NOT NULL DEFAULT '[]'::jsonb,
    usage jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (thread_id, external_item_id),
    FOREIGN KEY (thread_id, workspace_id) REFERENCES app.agent_threads(id, workspace_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS app.agent_event_logs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    thread_id uuid NOT NULL REFERENCES app.agent_threads(id) ON DELETE CASCADE,
    workspace_id uuid NOT NULL,
    event_type varchar(120) NOT NULL,
    payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    occurred_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (thread_id, workspace_id) REFERENCES app.agent_threads(id, workspace_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS canvas_projects_workspace_idx ON app.canvas_projects(workspace_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS canvas_nodes_project_idx ON app.canvas_nodes(project_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS canvas_connections_project_idx ON app.canvas_connections(project_id, created_at);
CREATE INDEX IF NOT EXISTS canvas_chat_messages_session_idx ON app.canvas_chat_messages(session_id, created_at);
CREATE INDEX IF NOT EXISTS agent_threads_workspace_idx ON app.agent_threads(workspace_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS agent_messages_thread_idx ON app.agent_messages(thread_id, created_at);
CREATE INDEX IF NOT EXISTS agent_event_logs_thread_idx ON app.agent_event_logs(thread_id, occurred_at);

INSERT INTO app.schema_migrations(version, checksum)
VALUES ('0005_canvas_agent', 'canvas-agent-v1')
ON CONFLICT (version) DO NOTHING;
COMMIT;
