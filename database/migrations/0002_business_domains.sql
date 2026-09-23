-- 轻域业务库业务域迁移
-- 目标数据库：qingyu_business
-- 说明：身份仍由 Appwrite 管理；本迁移保存业务事实、文件元数据、计费流水和模型目录。

BEGIN;

CREATE TABLE IF NOT EXISTS app.team_invitations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id uuid NOT NULL REFERENCES app.teams(id) ON DELETE RESTRICT,
    email text NOT NULL,
    invited_user_id uuid REFERENCES app.user_accounts(id) ON DELETE SET NULL,
    invited_by uuid REFERENCES app.user_accounts(id) ON DELETE SET NULL,
    token_hash text NOT NULL UNIQUE,
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','expired','revoked')),
    expires_at timestamptz NOT NULL,
    accepted_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app.permission_overrides (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES app.workspaces(id) ON DELETE RESTRICT,
    user_id uuid NOT NULL REFERENCES app.user_accounts(id) ON DELETE RESTRICT,
    permission_code varchar(120) NOT NULL,
    effect text NOT NULL CHECK (effect IN ('allow','deny')),
    reason text,
    expires_at timestamptz,
    created_by uuid REFERENCES app.user_accounts(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, user_id, permission_code)
);

CREATE TABLE IF NOT EXISTS app.access_policies (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES app.workspaces(id) ON DELETE RESTRICT,
    name varchar(120) NOT NULL,
    resource_type varchar(80) NOT NULL,
    effect text NOT NULL CHECK (effect IN ('allow','deny')),
    conditions jsonb NOT NULL DEFAULT '{}'::jsonb,
    enabled boolean NOT NULL DEFAULT true,
    created_by uuid REFERENCES app.user_accounts(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app.plans (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code varchar(64) NOT NULL UNIQUE,
    name varchar(120) NOT NULL,
    description text,
    currency varchar(3) NOT NULL DEFAULT 'CNY',
    price_minor bigint NOT NULL DEFAULT 0 CHECK (price_minor >= 0),
    billing_interval text NOT NULL DEFAULT 'month' CHECK (billing_interval IN ('none','month','year')),
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('draft','active','retired')),
    version integer NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app.plan_features (
    plan_id uuid NOT NULL REFERENCES app.plans(id) ON DELETE CASCADE,
    feature_code varchar(120) NOT NULL,
    enabled boolean NOT NULL DEFAULT true,
    PRIMARY KEY (plan_id, feature_code)
);

CREATE TABLE IF NOT EXISTS app.plan_quotas (
    plan_id uuid NOT NULL REFERENCES app.plans(id) ON DELETE CASCADE,
    quota_code varchar(120) NOT NULL,
    amount numeric(20,6) NOT NULL CHECK (amount >= 0),
    unit varchar(32) NOT NULL,
    reset_interval text CHECK (reset_interval IN ('none','day','month')),
    PRIMARY KEY (plan_id, quota_code)
);

CREATE TABLE IF NOT EXISTS app.subscriptions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES app.workspaces(id) ON DELETE RESTRICT,
    plan_id uuid NOT NULL REFERENCES app.plans(id) ON DELETE RESTRICT,
    status text NOT NULL DEFAULT 'trialing' CHECK (status IN ('trialing','active','past_due','paused','cancelled','expired')),
    provider varchar(64),
    provider_subscription_id varchar(160),
    current_period_start timestamptz NOT NULL,
    current_period_end timestamptz NOT NULL,
    cancel_at_period_end boolean NOT NULL DEFAULT false,
    version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (workspace_id)
);

CREATE TABLE IF NOT EXISTS app.subscription_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    subscription_id uuid NOT NULL REFERENCES app.subscriptions(id) ON DELETE RESTRICT,
    event_type varchar(64) NOT NULL,
    idempotency_key varchar(160) NOT NULL UNIQUE,
    provider_event_id varchar(160),
    payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    occurred_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app.payment_customers (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES app.workspaces(id) ON DELETE RESTRICT,
    provider varchar(64) NOT NULL,
    provider_customer_id varchar(160) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (provider, provider_customer_id),
    UNIQUE (workspace_id, provider)
);

CREATE TABLE IF NOT EXISTS app.orders (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES app.workspaces(id) ON DELETE RESTRICT,
    plan_id uuid REFERENCES app.plans(id) ON DELETE RESTRICT,
    order_no varchar(96) NOT NULL UNIQUE,
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','failed','cancelled','refunded','partially_refunded')),
    currency varchar(3) NOT NULL DEFAULT 'CNY',
    amount_minor bigint NOT NULL CHECK (amount_minor >= 0),
    idempotency_key varchar(160) NOT NULL UNIQUE,
    expires_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app.payments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id uuid NOT NULL REFERENCES app.orders(id) ON DELETE RESTRICT,
    provider varchar(64) NOT NULL,
    provider_payment_id varchar(160),
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','succeeded','failed','refunded','unknown')),
    amount_minor bigint NOT NULL CHECK (amount_minor >= 0),
    raw_reference jsonb NOT NULL DEFAULT '{}'::jsonb,
    paid_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (provider, provider_payment_id)
);

CREATE TABLE IF NOT EXISTS app.usage_records (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES app.workspaces(id) ON DELETE RESTRICT,
    user_id uuid REFERENCES app.user_accounts(id) ON DELETE SET NULL,
    feature_code varchar(120) NOT NULL,
    provider varchar(80),
    model varchar(160),
    quantity numeric(20,6) NOT NULL CHECK (quantity >= 0),
    unit varchar(32) NOT NULL,
    result text NOT NULL CHECK (result IN ('reserved','committed','released','failed','unknown')),
    idempotency_key varchar(160) NOT NULL UNIQUE,
    request_id varchar(160),
    occurred_at timestamptz NOT NULL DEFAULT now(),
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS app.quota_grants (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES app.workspaces(id) ON DELETE RESTRICT,
    quota_code varchar(120) NOT NULL,
    source_type varchar(32) NOT NULL CHECK (source_type IN ('plan','purchase','manual','refund')),
    source_id uuid,
    granted numeric(20,6) NOT NULL CHECK (granted >= 0),
    reserved numeric(20,6) NOT NULL DEFAULT 0 CHECK (reserved >= 0),
    consumed numeric(20,6) NOT NULL DEFAULT 0 CHECK (consumed >= 0),
    expires_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (reserved + consumed <= granted)
);

CREATE TABLE IF NOT EXISTS app.quota_allocations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    grant_id uuid NOT NULL REFERENCES app.quota_grants(id) ON DELETE RESTRICT,
    usage_record_id uuid REFERENCES app.usage_records(id) ON DELETE RESTRICT,
    amount numeric(20,6) NOT NULL CHECK (amount > 0),
    status text NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved','committed','released','expired')),
    idempotency_key varchar(160) NOT NULL UNIQUE,
    created_at timestamptz NOT NULL DEFAULT now(),
    settled_at timestamptz
);

CREATE TABLE IF NOT EXISTS app.file_objects (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid REFERENCES app.workspaces(id) ON DELETE RESTRICT,
    uploaded_by uuid REFERENCES app.user_accounts(id) ON DELETE SET NULL,
    storage_provider varchar(64) NOT NULL,
    bucket varchar(160) NOT NULL,
    object_key text NOT NULL,
    storage_version_id text,
    checksum varchar(128),
    size_bytes bigint CHECK (size_bytes >= 0),
    mime_type varchar(160),
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','ready','deleting','deleted')),
    created_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz,
    UNIQUE (storage_provider, bucket, object_key, storage_version_id)
);

CREATE TABLE IF NOT EXISTS app.generation_tasks (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES app.workspaces(id) ON DELETE RESTRICT,
    created_by uuid REFERENCES app.user_accounts(id) ON DELETE SET NULL,
    task_type varchar(32) NOT NULL CHECK (task_type IN ('image','video','audio','text','agent')),
    provider varchar(80),
    model varchar(160),
    model_version varchar(160),
    pricing_version varchar(160),
    prompt text,
    parameters jsonb NOT NULL DEFAULT '{}'::jsonb,
    status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','cancel_requested','reconciling','succeeded','failed','cancelled')),
    request_id varchar(160) NOT NULL UNIQUE,
    idempotency_key varchar(160) NOT NULL UNIQUE,
    error_code varchar(120),
    started_at timestamptz,
    finished_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app.generation_outputs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id uuid NOT NULL REFERENCES app.generation_tasks(id) ON DELETE RESTRICT,
    file_id uuid REFERENCES app.file_objects(id) ON DELETE RESTRICT,
    thumbnail_file_id uuid REFERENCES app.file_objects(id) ON DELETE RESTRICT,
    output_type varchar(32) NOT NULL,
    width integer CHECK (width > 0),
    height integer CHECK (height > 0),
    duration_ms integer CHECK (duration_ms >= 0),
    content_status text NOT NULL DEFAULT 'pending' CHECK (content_status IN ('pending','approved','rejected','unknown')),
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app.assets (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES app.workspaces(id) ON DELETE RESTRICT,
    created_by uuid REFERENCES app.user_accounts(id) ON DELETE SET NULL,
    source_generation_id uuid REFERENCES app.generation_tasks(id) ON DELETE SET NULL,
    asset_type varchar(32) NOT NULL,
    title varchar(240) NOT NULL,
    description text,
    visibility text NOT NULL DEFAULT 'private' CHECK (visibility IN ('private','workspace','shared','public')),
    moderation_status text NOT NULL DEFAULT 'pending' CHECK (moderation_status IN ('pending','approved','rejected')),
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived','deleted')),
    version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS app.asset_versions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_id uuid NOT NULL REFERENCES app.assets(id) ON DELETE RESTRICT,
    version_no integer NOT NULL CHECK (version_no > 0),
    created_by uuid REFERENCES app.user_accounts(id) ON DELETE SET NULL,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (asset_id, version_no)
);

CREATE TABLE IF NOT EXISTS app.asset_files (
    asset_version_id uuid NOT NULL REFERENCES app.asset_versions(id) ON DELETE RESTRICT,
    file_id uuid NOT NULL REFERENCES app.file_objects(id) ON DELETE RESTRICT,
    role varchar(32) NOT NULL CHECK (role IN ('source','preview','thumbnail','attachment')),
    PRIMARY KEY (asset_version_id, file_id, role)
);

CREATE TABLE IF NOT EXISTS app.asset_shares (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_id uuid NOT NULL REFERENCES app.assets(id) ON DELETE RESTRICT,
    shared_by uuid REFERENCES app.user_accounts(id) ON DELETE SET NULL,
    target_type text NOT NULL CHECK (target_type IN ('workspace','team','department','user','public_link')),
    target_id uuid,
    token_hash text UNIQUE,
    permission text NOT NULL DEFAULT 'view' CHECK (permission IN ('view','use','edit','manage')),
    expires_at timestamptz,
    revoked_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app.asset_references (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    source_asset_id uuid NOT NULL REFERENCES app.assets(id) ON DELETE RESTRICT,
    target_asset_id uuid NOT NULL REFERENCES app.assets(id) ON DELETE RESTRICT,
    referenced_by uuid REFERENCES app.user_accounts(id) ON DELETE SET NULL,
    purpose varchar(120),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (source_asset_id, target_asset_id, purpose)
);

CREATE TABLE IF NOT EXISTS app.collections (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES app.workspaces(id) ON DELETE RESTRICT,
    created_by uuid REFERENCES app.user_accounts(id) ON DELETE SET NULL,
    name varchar(160) NOT NULL,
    description text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app.collection_items (
    collection_id uuid NOT NULL REFERENCES app.collections(id) ON DELETE CASCADE,
    asset_id uuid NOT NULL REFERENCES app.assets(id) ON DELETE RESTRICT,
    added_by uuid REFERENCES app.user_accounts(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (collection_id, asset_id)
);

CREATE TABLE IF NOT EXISTS app.asset_likes (
    asset_id uuid NOT NULL REFERENCES app.assets(id) ON DELETE RESTRICT,
    user_id uuid NOT NULL REFERENCES app.user_accounts(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (asset_id, user_id)
);

CREATE TABLE IF NOT EXISTS app.asset_comments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_id uuid NOT NULL REFERENCES app.assets(id) ON DELETE RESTRICT,
    parent_id uuid REFERENCES app.asset_comments(id) ON DELETE RESTRICT,
    author_user_id uuid REFERENCES app.user_accounts(id) ON DELETE SET NULL,
    content text NOT NULL CHECK (char_length(content) <= 10000),
    moderation_status text NOT NULL DEFAULT 'pending' CHECK (moderation_status IN ('pending','approved','rejected')),
    edited_at timestamptz,
    deleted_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app.moderation_records (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_id uuid REFERENCES app.assets(id) ON DELETE RESTRICT,
    comment_id uuid REFERENCES app.asset_comments(id) ON DELETE RESTRICT,
    decision text NOT NULL CHECK (decision IN ('approved','rejected','pending')),
    reason text,
    reviewer_user_id uuid REFERENCES app.user_accounts(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK ((asset_id IS NOT NULL) <> (comment_id IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS app.ai_providers (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code varchar(80) NOT NULL UNIQUE,
    name varchar(160) NOT NULL,
    base_url text NOT NULL,
    capabilities jsonb NOT NULL DEFAULT '{}'::jsonb,
    enabled boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app.provider_credentials (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_id uuid NOT NULL REFERENCES app.ai_providers(id) ON DELETE RESTRICT,
    name varchar(120) NOT NULL,
    secret_ref text NOT NULL,
    key_version varchar(64),
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled','rotating','revoked')),
    created_by uuid REFERENCES app.user_accounts(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app.ai_models (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_id uuid NOT NULL REFERENCES app.ai_providers(id) ON DELETE RESTRICT,
    code varchar(160) NOT NULL,
    display_name varchar(160) NOT NULL,
    capabilities jsonb NOT NULL DEFAULT '{}'::jsonb,
    limits jsonb NOT NULL DEFAULT '{}'::jsonb,
    pricing jsonb NOT NULL DEFAULT '{}'::jsonb,
    enabled boolean NOT NULL DEFAULT true,
    version integer NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (provider_id, code)
);

CREATE TABLE IF NOT EXISTS app.notifications (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES app.user_accounts(id) ON DELETE CASCADE,
    workspace_id uuid REFERENCES app.workspaces(id) ON DELETE SET NULL,
    type varchar(80) NOT NULL,
    title varchar(240) NOT NULL,
    body text,
    payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    read_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app.consent_records (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES app.user_accounts(id) ON DELETE RESTRICT,
    consent_type varchar(120) NOT NULL,
    policy_version varchar(64) NOT NULL,
    granted boolean NOT NULL,
    source varchar(32) NOT NULL DEFAULT 'web',
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS team_invitations_team_idx ON app.team_invitations(team_id, status, expires_at);
CREATE INDEX IF NOT EXISTS permission_overrides_user_idx ON app.permission_overrides(user_id, workspace_id);
CREATE INDEX IF NOT EXISTS subscriptions_period_idx ON app.subscriptions(current_period_end, status);
CREATE INDEX IF NOT EXISTS usage_records_workspace_idx ON app.usage_records(workspace_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS quota_grants_available_idx ON app.quota_grants(workspace_id, quota_code, expires_at);
CREATE INDEX IF NOT EXISTS generation_tasks_workspace_idx ON app.generation_tasks(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS generation_tasks_status_idx ON app.generation_tasks(status, created_at);
CREATE INDEX IF NOT EXISTS generation_outputs_task_idx ON app.generation_outputs(task_id, created_at);
CREATE INDEX IF NOT EXISTS assets_workspace_idx ON app.assets(workspace_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS asset_shares_asset_idx ON app.asset_shares(asset_id, revoked_at, expires_at);
CREATE INDEX IF NOT EXISTS asset_comments_asset_idx ON app.asset_comments(asset_id, created_at);
CREATE INDEX IF NOT EXISTS notifications_user_idx ON app.notifications(user_id, read_at, created_at DESC);
CREATE INDEX IF NOT EXISTS file_objects_workspace_idx ON app.file_objects(workspace_id, status, created_at DESC);

INSERT INTO app.schema_migrations(version, checksum)
VALUES ('0002_business_domains', 'business-domains-v1')
ON CONFLICT (version) DO NOTHING;

COMMIT;
