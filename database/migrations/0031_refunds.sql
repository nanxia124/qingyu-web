-- 退款申请和退款尝试独立记录；不覆盖原支付事实，也不把申请伪装成已退款。
BEGIN;
SELECT pg_advisory_xact_lock(70420260931);

CREATE TABLE IF NOT EXISTS app.refunds (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES app.workspaces(id) ON DELETE RESTRICT,
    order_id uuid NOT NULL REFERENCES app.orders(id) ON DELETE RESTRICT,
    payment_id uuid REFERENCES app.payments(id) ON DELETE RESTRICT,
    amount_minor bigint NOT NULL CHECK (amount_minor > 0),
    currency varchar(3) NOT NULL DEFAULT 'CNY',
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','succeeded','failed','unknown')),
    idempotency_key varchar(160) NOT NULL UNIQUE,
    provider_refund_id varchar(200),
    reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 2000),
    requested_by uuid REFERENCES app.user_accounts(id) ON DELETE SET NULL,
    raw_reference jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz,
    UNIQUE (payment_id, provider_refund_id)
);

CREATE INDEX IF NOT EXISTS refunds_workspace_idx ON app.refunds(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS refunds_order_idx ON app.refunds(order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS refunds_pending_idx ON app.refunds(status, created_at DESC)
    WHERE status IN ('pending','processing','unknown');

CREATE OR REPLACE FUNCTION app.touch_refund_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at=now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS refunds_touch_updated ON app.refunds;
CREATE TRIGGER refunds_touch_updated BEFORE UPDATE ON app.refunds
FOR EACH ROW EXECUTE FUNCTION app.touch_refund_updated_at();

ALTER TABLE app.refunds ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS refund_owner_isolation ON app.refunds;
CREATE POLICY refund_owner_isolation ON app.refunds
    USING (app.has_workspace_access(workspace_id))
    WITH CHECK (app.has_workspace_access(workspace_id));

GRANT SELECT,INSERT,UPDATE ON app.refunds TO qingyu_api;

INSERT INTO app.schema_migrations(version, checksum)
VALUES ('0031_refunds', 'refunds-v1')
ON CONFLICT (version) DO NOTHING;
COMMIT;
