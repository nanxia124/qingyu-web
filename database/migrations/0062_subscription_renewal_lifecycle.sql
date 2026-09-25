-- 续费周期与授权资料落库；真实扣款默认关闭，只有接入并验收支付渠道后才能启用。
BEGIN;
SELECT pg_advisory_xact_lock(70420260962);

ALTER TABLE app.subscriptions
    ADD COLUMN IF NOT EXISTS billing_anchor_month smallint,
    ADD COLUMN IF NOT EXISTS billing_anchor_day smallint,
    ADD COLUMN IF NOT EXISTS billing_timezone varchar(64) NOT NULL DEFAULT 'UTC';

UPDATE app.subscriptions
SET billing_anchor_month = extract(month FROM current_period_start AT TIME ZONE 'UTC')::smallint,
    billing_anchor_day = extract(day FROM current_period_start AT TIME ZONE 'UTC')::smallint
WHERE billing_anchor_month IS NULL OR billing_anchor_day IS NULL;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='subscriptions_billing_anchor_check') THEN
        ALTER TABLE app.subscriptions ADD CONSTRAINT subscriptions_billing_anchor_check
            CHECK ((billing_anchor_month IS NULL OR billing_anchor_month BETWEEN 1 AND 12)
               AND (billing_anchor_day IS NULL OR billing_anchor_day BETWEEN 1 AND 31));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='subscriptions_billing_timezone_check') THEN
        ALTER TABLE app.subscriptions ADD CONSTRAINT subscriptions_billing_timezone_check
            CHECK (length(btrim(billing_timezone)) > 0);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='subscriptions_id_workspace_key') THEN
        ALTER TABLE app.subscriptions ADD CONSTRAINT subscriptions_id_workspace_key UNIQUE (id, workspace_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='orders_id_workspace_key') THEN
        ALTER TABLE app.orders ADD CONSTRAINT orders_id_workspace_key UNIQUE (id, workspace_id);
    END IF;
END $$;

CREATE TABLE app.renewal_mandates (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES app.workspaces(id) ON DELETE RESTRICT,
    subscription_id uuid NOT NULL,
    provider varchar(64) NOT NULL,
    provider_account_id varchar(160) NOT NULL,
    environment text NOT NULL CHECK (environment IN ('test','live')),
    collection_owner text NOT NULL CHECK (collection_owner IN ('provider_managed','merchant_managed')),
    provider_mandate_id varchar(200),
    authorized_by uuid NOT NULL REFERENCES app.user_accounts(id) ON DELETE RESTRICT,
    terms_version varchar(120) NOT NULL,
    terms_hash varchar(128) NOT NULL CHECK (terms_hash ~ '^[0-9a-f]{64}$'),
    consented_at timestamptz NOT NULL,
    plan_id uuid NOT NULL REFERENCES app.plans(id) ON DELETE RESTRICT,
    plan_version_id uuid NOT NULL,
    max_amount_minor bigint NOT NULL CHECK (max_amount_minor > 0),
    currency varchar(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    billing_interval text NOT NULL CHECK (billing_interval IN ('month','year')),
    billing_timezone varchar(64) NOT NULL DEFAULT 'UTC' CHECK (length(btrim(billing_timezone)) > 0),
    status text NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','active','revoking','revoked','expired','failed')),
    authorized_at timestamptz,
    cancel_requested_at timestamptz,
    cancelled_at timestamptz,
    provider_status text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (id, workspace_id),
    UNIQUE (id, subscription_id, workspace_id, collection_owner, provider, provider_account_id, environment,
        plan_id, plan_version_id, max_amount_minor, currency, billing_interval, billing_timezone),
    FOREIGN KEY (subscription_id, workspace_id)
        REFERENCES app.subscriptions(id, workspace_id) ON DELETE RESTRICT,
    FOREIGN KEY (plan_version_id, plan_id)
        REFERENCES app.plan_versions(id, plan_id) ON DELETE RESTRICT,
    CHECK (status <> 'active' OR (provider_mandate_id IS NOT NULL AND authorized_by IS NOT NULL AND authorized_at IS NOT NULL))
);
CREATE UNIQUE INDEX renewal_mandates_provider_id_unique
    ON app.renewal_mandates(provider, provider_account_id, environment, provider_mandate_id)
    WHERE provider_mandate_id IS NOT NULL;
CREATE UNIQUE INDEX renewal_mandates_one_open_per_subscription
    ON app.renewal_mandates(subscription_id)
    WHERE status IN ('pending','active','revoking');
CREATE INDEX renewal_mandates_workspace_idx
    ON app.renewal_mandates(workspace_id, created_at DESC);

CREATE TABLE app.billing_cycles (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES app.workspaces(id) ON DELETE RESTRICT,
    subscription_id uuid NOT NULL,
    sequence integer NOT NULL CHECK (sequence > 0),
    period_start timestamptz NOT NULL,
    period_end timestamptz NOT NULL,
    due_at timestamptz NOT NULL,
    amount_minor bigint NOT NULL CHECK (amount_minor > 0),
    currency varchar(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    plan_id uuid NOT NULL REFERENCES app.plans(id) ON DELETE RESTRICT,
    plan_version_id uuid NOT NULL,
    billing_interval text NOT NULL CHECK (billing_interval IN ('month','year')),
    billing_timezone varchar(64) NOT NULL CHECK (length(btrim(billing_timezone)) > 0),
    authorized_max_amount_minor bigint NOT NULL CHECK (authorized_max_amount_minor > 0),
    mandate_id uuid NOT NULL,
    order_id uuid REFERENCES app.orders(id) ON DELETE RESTRICT,
    collection_owner text NOT NULL CHECK (collection_owner IN ('provider_managed','merchant_managed')),
    provider varchar(64) NOT NULL,
    provider_account_id varchar(160) NOT NULL,
    environment text NOT NULL CHECK (environment IN ('test','live')),
    provider_cycle_id varchar(200),
    status text NOT NULL DEFAULT 'scheduled'
        CHECK (status IN ('scheduled','reminder_pending','ready','processing','requires_action','review','paid','failed','cancelled')),
    idempotency_key varchar(200) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (id, workspace_id),
    UNIQUE (id, workspace_id, provider, provider_account_id, environment),
    UNIQUE (subscription_id, sequence),
    UNIQUE (workspace_id, idempotency_key),
    FOREIGN KEY (subscription_id, workspace_id)
        REFERENCES app.subscriptions(id, workspace_id) ON DELETE RESTRICT,
    FOREIGN KEY (order_id, workspace_id)
        REFERENCES app.orders(id, workspace_id) ON DELETE RESTRICT,
    FOREIGN KEY (plan_version_id, plan_id)
        REFERENCES app.plan_versions(id, plan_id) ON DELETE RESTRICT,
    CONSTRAINT billing_cycles_mandate_scope_fkey
        FOREIGN KEY (mandate_id, subscription_id, workspace_id, collection_owner, provider, provider_account_id, environment,
            plan_id, plan_version_id, authorized_max_amount_minor, currency, billing_interval, billing_timezone)
        REFERENCES app.renewal_mandates(id, subscription_id, workspace_id, collection_owner, provider, provider_account_id, environment,
            plan_id, plan_version_id, max_amount_minor, currency, billing_interval, billing_timezone) ON DELETE RESTRICT,
    CHECK (period_end > period_start AND due_at >= period_start AND due_at < period_end),
    CONSTRAINT billing_cycles_authorized_amount_check CHECK (amount_minor <= authorized_max_amount_minor)
);
CREATE UNIQUE INDEX billing_cycles_provider_cycle_unique
    ON app.billing_cycles(provider, provider_account_id, environment, provider_cycle_id)
    WHERE provider_cycle_id IS NOT NULL;
CREATE INDEX billing_cycles_due_idx
    ON app.billing_cycles(status, due_at, created_at)
    WHERE status IN ('scheduled','reminder_pending','ready','requires_action');
CREATE INDEX billing_cycles_subscription_period_idx
    ON app.billing_cycles(subscription_id, period_start DESC);

CREATE TABLE app.renewal_attempts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES app.workspaces(id) ON DELETE RESTRICT,
    cycle_id uuid NOT NULL,
    attempt_no integer NOT NULL CHECK (attempt_no > 0),
    provider varchar(64) NOT NULL,
    provider_account_id varchar(160) NOT NULL,
    environment text NOT NULL CHECK (environment IN ('test','live')),
    provider_request_id varchar(200),
    provider_payment_id varchar(200),
    status text NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued','processing','succeeded','failed','unknown','requires_action','cancelled')),
    failure_class text,
    scheduled_at timestamptz NOT NULL,
    sent_at timestamptz,
    next_retry_at timestamptz,
    completed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (cycle_id, attempt_no),
    CONSTRAINT renewal_attempts_provider_scope_fkey
        FOREIGN KEY (cycle_id, workspace_id, provider, provider_account_id, environment)
        REFERENCES app.billing_cycles(id, workspace_id, provider, provider_account_id, environment) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX renewal_attempts_provider_request_unique
    ON app.renewal_attempts(provider, provider_account_id, environment, provider_request_id)
    WHERE provider_request_id IS NOT NULL;
CREATE UNIQUE INDEX renewal_attempts_provider_payment_unique
    ON app.renewal_attempts(provider, provider_account_id, environment, provider_payment_id)
    WHERE provider_payment_id IS NOT NULL;
CREATE INDEX renewal_attempts_retry_idx
    ON app.renewal_attempts(status, next_retry_at)
    WHERE status IN ('queued','failed','unknown');

CREATE TABLE app.renewal_reminders (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES app.workspaces(id) ON DELETE RESTRICT,
    cycle_id uuid NOT NULL,
    reminder_type text NOT NULL CHECK (reminder_type IN ('upcoming','payment_failed','action_required','cancelled')),
    channel text NOT NULL CHECK (channel IN ('in_app','email','sms')),
    destination_ref varchar(200),
    scheduled_at timestamptz NOT NULL,
    sent_at timestamptz,
    delivery_status text NOT NULL DEFAULT 'queued'
        CHECK (delivery_status IN ('queued','sent','failed','suppressed')),
    template_version varchar(120) NOT NULL,
    content_hash varchar(128) NOT NULL,
    idempotency_key varchar(200) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, idempotency_key),
    FOREIGN KEY (cycle_id, workspace_id)
        REFERENCES app.billing_cycles(id, workspace_id) ON DELETE RESTRICT
);
CREATE INDEX renewal_reminders_due_idx
    ON app.renewal_reminders(delivery_status, scheduled_at)
    WHERE delivery_status='queued';

DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['renewal_mandates','billing_cycles','renewal_attempts','renewal_reminders'] LOOP
        EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('CREATE POLICY workspace_isolation ON app.%I USING (app.has_workspace_access(workspace_id)) WITH CHECK (app.has_workspace_access(workspace_id))', t);
        EXECUTE format('GRANT SELECT, INSERT, UPDATE ON app.%I TO qingyu_api', t);
    END LOOP;
END $$;

INSERT INTO app.schema_migrations(version, checksum)
VALUES ('0062_subscription_renewal_lifecycle', 'subscription-renewal-lifecycle-v1')
ON CONFLICT (version) DO NOTHING;
COMMIT;
