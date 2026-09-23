-- 轻域业务库运营记录迁移
-- 补齐成员流程、空间 API 渠道和供应商日汇总。

BEGIN;

CREATE TABLE IF NOT EXISTS app.membership_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    membership_id uuid NOT NULL REFERENCES app.team_memberships(id) ON DELETE RESTRICT,
    event_type text NOT NULL CHECK (event_type IN ('invited','accepted','joined','suspended','reinstated','left','removed')),
    actor_user_id uuid REFERENCES app.user_accounts(id) ON DELETE SET NULL,
    reason text,
    request_id varchar(160),
    occurred_at timestamptz NOT NULL DEFAULT now(),
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS app.ai_channels (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES app.workspaces(id) ON DELETE RESTRICT,
    created_by uuid REFERENCES app.user_accounts(id) ON DELETE SET NULL,
    provider_id uuid REFERENCES app.ai_providers(id) ON DELETE RESTRICT,
    name varchar(120) NOT NULL,
    base_url text NOT NULL,
    secret_ref text NOT NULL,
    model_allowlist jsonb NOT NULL DEFAULT '[]'::jsonb,
    max_concurrency integer CHECK (max_concurrency IS NULL OR max_concurrency > 0),
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled','rotating','revoked')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, name)
);

CREATE TABLE IF NOT EXISTS app.provider_call_daily (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    day date NOT NULL,
    provider_id uuid REFERENCES app.ai_providers(id) ON DELETE RESTRICT,
    model varchar(160) NOT NULL,
    capability varchar(80) NOT NULL,
    request_count bigint NOT NULL DEFAULT 0 CHECK (request_count >= 0),
    success_count bigint NOT NULL DEFAULT 0 CHECK (success_count >= 0),
    failure_count bigint NOT NULL DEFAULT 0 CHECK (failure_count >= 0),
    input_units numeric(24,6) NOT NULL DEFAULT 0 CHECK (input_units >= 0),
    output_units numeric(24,6) NOT NULL DEFAULT 0 CHECK (output_units >= 0),
    total_cost_minor bigint NOT NULL DEFAULT 0 CHECK (total_cost_minor >= 0),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (day, provider_id, model, capability)
);

CREATE INDEX IF NOT EXISTS membership_events_membership_idx ON app.membership_events(membership_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS ai_channels_workspace_idx ON app.ai_channels(workspace_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS provider_call_daily_lookup_idx ON app.provider_call_daily(day DESC, provider_id, model);

INSERT INTO app.schema_migrations(version, checksum)
VALUES ('0003_operational_records', 'operational-records-v1')
ON CONFLICT (version) DO NOTHING;

COMMIT;
