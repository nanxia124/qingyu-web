-- 轻域业务库基础迁移
-- 目标数据库：qingyu_business
-- 说明：Appwrite 只负责身份认证；本库负责业务归属、权限、会话准入和审计。
-- 这份迁移只应由受控部署执行，禁止前端直接连接数据库。

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS app;

CREATE TABLE app.schema_migrations (
    version text PRIMARY KEY,
    checksum text NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now()
);

DO $$ BEGIN
    CREATE TYPE app.user_status AS ENUM ('active', 'suspended', 'deleted');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
    CREATE TYPE app.workspace_type AS ENUM ('personal', 'team');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
    CREATE TYPE app.workspace_status AS ENUM ('active', 'archived', 'deleted');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
    CREATE TYPE app.team_status AS ENUM ('active', 'suspended', 'deleted');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
    CREATE TYPE app.membership_status AS ENUM ('invited', 'active', 'suspended', 'left');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
    CREATE TYPE app.session_status AS ENUM ('pending', 'active', 'denied', 'revoked');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
    CREATE TYPE app.provider_revoke_status AS ENUM ('not_requested', 'pending', 'succeeded', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE app.user_accounts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    appwrite_user_id varchar(64) NOT NULL UNIQUE,
    email text,
    display_name varchar(100),
    avatar_file_id uuid,
    locale varchar(16) NOT NULL DEFAULT 'zh-CN',
    timezone varchar(64) NOT NULL DEFAULT 'Asia/Shanghai',
    status app.user_status NOT NULL DEFAULT 'active',
    auth_version bigint NOT NULL DEFAULT 0 CHECK (auth_version >= 0),
    last_login_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.user_preferences (
    user_id uuid PRIMARY KEY REFERENCES app.user_accounts(id) ON DELETE RESTRICT,
    values jsonb NOT NULL DEFAULT '{}'::jsonb,
    version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.teams (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name varchar(120) NOT NULL,
    slug varchar(80) NOT NULL UNIQUE,
    owner_user_id uuid NOT NULL REFERENCES app.user_accounts(id) ON DELETE RESTRICT,
    status app.team_status NOT NULL DEFAULT 'active',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.workspaces (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    type app.workspace_type NOT NULL,
    team_id uuid REFERENCES app.teams(id) ON DELETE RESTRICT,
    owner_user_id uuid REFERENCES app.user_accounts(id) ON DELETE RESTRICT,
    name varchar(120) NOT NULL,
    status app.workspace_status NOT NULL DEFAULT 'active',
    version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK ((type = 'personal' AND team_id IS NULL AND owner_user_id IS NOT NULL)
        OR (type = 'team' AND team_id IS NOT NULL AND owner_user_id IS NULL))
);
CREATE UNIQUE INDEX workspaces_one_personal_owner
    ON app.workspaces(owner_user_id) WHERE type = 'personal' AND status <> 'deleted';
CREATE UNIQUE INDEX workspaces_one_team
    ON app.workspaces(team_id) WHERE type = 'team' AND status <> 'deleted';

CREATE TABLE app.departments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id uuid NOT NULL REFERENCES app.teams(id) ON DELETE RESTRICT,
    parent_id uuid,
    name varchar(120) NOT NULL,
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived', 'deleted')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (id, team_id),
    UNIQUE (team_id, parent_id, name),
    FOREIGN KEY (parent_id, team_id) REFERENCES app.departments(id, team_id) ON DELETE RESTRICT
);

CREATE TABLE app.job_titles (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id uuid NOT NULL REFERENCES app.teams(id) ON DELETE RESTRICT,
    name varchar(120) NOT NULL,
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived', 'deleted')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (team_id, name),
    UNIQUE (id, team_id)
);

CREATE TABLE app.team_memberships (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id uuid NOT NULL REFERENCES app.teams(id) ON DELETE RESTRICT,
    user_id uuid NOT NULL REFERENCES app.user_accounts(id) ON DELETE RESTRICT,
    department_id uuid,
    job_title_id uuid,
    status app.membership_status NOT NULL DEFAULT 'invited',
    joined_at timestamptz,
    left_at timestamptz,
    invited_by uuid REFERENCES app.user_accounts(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (team_id, user_id),
    FOREIGN KEY (department_id, team_id) REFERENCES app.departments(id, team_id) ON DELETE RESTRICT,
    FOREIGN KEY (job_title_id, team_id) REFERENCES app.job_titles(id, team_id) ON DELETE RESTRICT,
    CHECK ((status = 'left' AND left_at IS NOT NULL) OR status <> 'left')
);

CREATE TABLE app.roles (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code varchar(64) NOT NULL UNIQUE,
    name varchar(120) NOT NULL,
    description text,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.permissions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code varchar(120) NOT NULL UNIQUE,
    description text,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.role_permissions (
    role_id uuid NOT NULL REFERENCES app.roles(id) ON DELETE CASCADE,
    permission_id uuid NOT NULL REFERENCES app.permissions(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE app.role_bindings (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES app.workspaces(id) ON DELETE RESTRICT,
    user_id uuid NOT NULL REFERENCES app.user_accounts(id) ON DELETE RESTRICT,
    role_id uuid NOT NULL REFERENCES app.roles(id) ON DELETE RESTRICT,
    created_by uuid REFERENCES app.user_accounts(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, user_id, role_id)
);

CREATE TABLE app.user_devices (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES app.user_accounts(id) ON DELETE RESTRICT,
    installation_id uuid NOT NULL,
    display_name varchar(120) NOT NULL DEFAULT '未命名设备',
    client_type varchar(32) NOT NULL DEFAULT 'web',
    os_family varchar(64) NOT NULL DEFAULT 'unknown',
    browser_family varchar(64) NOT NULL DEFAULT 'unknown',
    created_at timestamptz NOT NULL DEFAULT now(),
    last_seen_at timestamptz,
    archived_at timestamptz,
    UNIQUE (user_id, installation_id),
    UNIQUE (id, user_id)
);

CREATE TABLE app.user_sessions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES app.user_accounts(id) ON DELETE RESTRICT,
    device_id uuid NOT NULL,
    identity_provider varchar(32) NOT NULL DEFAULT 'appwrite',
    provider_session_id varchar(128) NOT NULL,
    admission_status app.session_status NOT NULL DEFAULT 'pending',
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    last_seen_at timestamptz,
    revoked_at timestamptz,
    revoked_reason varchar(64),
    admitted_auth_version bigint NOT NULL DEFAULT 0 CHECK (admitted_auth_version >= 0),
    provider_revocation_status app.provider_revoke_status NOT NULL DEFAULT 'not_requested',
    revoke_retry_at timestamptz,
    revoke_attempts integer NOT NULL DEFAULT 0 CHECK (revoke_attempts >= 0),
    UNIQUE (identity_provider, provider_session_id),
    FOREIGN KEY (device_id, user_id) REFERENCES app.user_devices(id, user_id) ON DELETE RESTRICT,
    CHECK (revoked_at IS NULL OR admission_status = 'revoked')
);

CREATE TABLE app.security_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES app.user_accounts(id) ON DELETE SET NULL,
    session_id uuid REFERENCES app.user_sessions(id) ON DELETE SET NULL,
    workspace_id uuid REFERENCES app.workspaces(id) ON DELETE SET NULL,
    event_type varchar(80) NOT NULL,
    result varchar(32) NOT NULL,
    request_id varchar(128),
    ip_hash varchar(128),
    user_agent_hash varchar(128),
    details jsonb NOT NULL DEFAULT '{}'::jsonb,
    occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.audit_logs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_user_id uuid REFERENCES app.user_accounts(id) ON DELETE SET NULL,
    workspace_id uuid REFERENCES app.workspaces(id) ON DELETE SET NULL,
    action varchar(120) NOT NULL,
    resource_type varchar(80),
    resource_id uuid,
    result varchar(32) NOT NULL,
    request_id varchar(128),
    before_summary jsonb,
    after_summary jsonb,
    occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.outbox_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type varchar(120) NOT NULL,
    schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version > 0),
    aggregate_type varchar(80) NOT NULL,
    aggregate_id uuid NOT NULL,
    workspace_id uuid REFERENCES app.workspaces(id) ON DELETE SET NULL,
    payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    status varchar(32) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'published', 'dead')),
    attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    available_at timestamptz NOT NULL DEFAULT now(),
    published_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX team_memberships_user_idx ON app.team_memberships(user_id, status);
CREATE INDEX role_bindings_user_idx ON app.role_bindings(user_id, workspace_id);
CREATE INDEX user_sessions_user_idx ON app.user_sessions(user_id, created_at DESC);
CREATE INDEX user_sessions_revoke_retry_idx ON app.user_sessions(revoke_retry_at) WHERE provider_revocation_status IN ('pending', 'failed');
CREATE INDEX security_events_user_idx ON app.security_events(user_id, occurred_at DESC);
CREATE INDEX audit_logs_workspace_idx ON app.audit_logs(workspace_id, occurred_at DESC);
CREATE INDEX outbox_pending_idx ON app.outbox_events(status, available_at, created_at) WHERE status IN ('pending', 'processing');

INSERT INTO app.roles (code, name, description) VALUES
    ('owner', '所有者', '管理空间全部内容和成员'),
    ('admin', '管理员', '管理空间和大部分业务数据'),
    ('editor', '编辑者', '创建、编辑和分享内容'),
    ('viewer', '查看者', '查看有权限的数据'),
    ('member', '成员', '使用已分配的功能')
ON CONFLICT (code) DO NOTHING;

INSERT INTO app.schema_migrations(version, checksum)
VALUES ('0001_foundation', 'foundation-v1')
ON CONFLICT (version) DO NOTHING;

COMMIT;
