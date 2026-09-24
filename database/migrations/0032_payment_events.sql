-- 第三方支付回调接收事实。收到不等于入账，后续处理器必须按事件状态推进。
BEGIN;
SELECT pg_advisory_xact_lock(70420260932);

CREATE TABLE IF NOT EXISTS app.payment_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    provider varchar(64) NOT NULL,
    provider_event_id varchar(200) NOT NULL,
    event_type varchar(120) NOT NULL,
    order_id uuid REFERENCES app.orders(id) ON DELETE RESTRICT,
    payment_id uuid REFERENCES app.payments(id) ON DELETE RESTRICT,
    amount_minor bigint CHECK (amount_minor IS NULL OR amount_minor >= 0),
    currency varchar(3),
    status text NOT NULL DEFAULT 'received' CHECK (status IN ('received','processing','processed','failed','ignored')),
    payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    signature_verified boolean NOT NULL DEFAULT false,
    error_message text,
    received_at timestamptz NOT NULL DEFAULT now(),
    processed_at timestamptz,
    UNIQUE(provider, provider_event_id)
);

CREATE INDEX IF NOT EXISTS payment_events_status_idx ON app.payment_events(status, received_at);
CREATE INDEX IF NOT EXISTS payment_events_order_idx ON app.payment_events(order_id, received_at DESC);

GRANT SELECT,INSERT,UPDATE ON app.payment_events TO qingyu_api;

INSERT INTO app.schema_migrations(version, checksum)
VALUES ('0032_payment_events', 'payment-events-v1')
ON CONFLICT (version) DO NOTHING;
COMMIT;
