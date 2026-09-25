-- 支付事实保留每笔真实收款；通知失败可自动重试，异常情况进入人工核对。
BEGIN;
SELECT pg_advisory_xact_lock(70420260956);

-- 一个订单可确实收到多笔钱；同一付款平台交易号仍由 payments 的唯一约束去重。
DROP INDEX IF EXISTS app.payments_one_success_per_order;
DROP INDEX IF EXISTS app.payments_one_active_attempt_per_order_provider;
CREATE UNIQUE INDEX payments_one_pending_attempt_per_order_provider
    ON app.payments(order_id, provider)
    WHERE status = 'pending';

-- 实收按平台实际回来的金额和币种留账；异常金额不能被改写成订单标价。
ALTER TABLE app.payments ADD COLUMN IF NOT EXISTS currency varchar(3);
UPDATE app.payments pay SET currency=o.currency FROM app.orders o
    WHERE o.id=pay.order_id AND pay.currency IS NULL;
ALTER TABLE app.payments ALTER COLUMN currency SET NOT NULL;
ALTER TABLE app.payments DROP CONSTRAINT IF EXISTS payments_currency_check;
ALTER TABLE app.payments ADD CONSTRAINT payments_currency_check CHECK (currency ~ '^[A-Z]{3}$');

CREATE OR REPLACE FUNCTION app.validate_payment_amount()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE order_currency varchar(3);
BEGIN
    SELECT currency INTO order_currency FROM app.orders WHERE id=NEW.order_id;
    IF order_currency IS NULL THEN RAISE EXCEPTION '支付对应的订单不存在'; END IF;
    IF NEW.status='succeeded' AND NEW.amount_minor<=0 THEN
        RAISE EXCEPTION '成功收款金额必须大于零';
    END IF;
    NEW.currency:=upper(coalesce(NEW.currency,order_currency));
    RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS payment_amount_check ON app.payments;
CREATE TRIGGER payment_amount_check
BEFORE INSERT OR UPDATE OF order_id,amount_minor,currency,status ON app.payments
FOR EACH ROW EXECUTE FUNCTION app.validate_payment_amount();

ALTER TABLE app.payment_events
    ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    ADD COLUMN IF NOT EXISTS next_retry_at timestamptz DEFAULT now(),
    ADD COLUMN IF NOT EXISTS last_attempt_at timestamptz;

ALTER TABLE app.payment_events DROP CONSTRAINT IF EXISTS payment_events_status_check;
ALTER TABLE app.payment_events ADD CONSTRAINT payment_events_status_check
    CHECK (status IN ('received','processing','processed','failed','ignored','review'));

DROP INDEX IF EXISTS app.payment_events_status_idx;
CREATE INDEX payment_events_retry_due_idx
    ON app.payment_events(next_retry_at, received_at)
    WHERE status IN ('received','failed') AND signature_verified = true;

-- 业务账号只能通过受控函数写支付告警，不能直接改写告警表。
CREATE OR REPLACE FUNCTION app.record_payment_alert(
    p_alert_type varchar, p_severity varchar, p_workspace_id uuid, p_summary text, p_detail jsonb
) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = app, pg_temp
AS $$
    INSERT INTO app.platform_alerts(alert_type,severity,workspace_id,summary,detail)
    VALUES (p_alert_type,p_severity,p_workspace_id,p_summary,coalesce(p_detail,'{}'::jsonb))
    ON CONFLICT DO NOTHING;
$$;
REVOKE ALL ON FUNCTION app.record_payment_alert(varchar,varchar,uuid,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.record_payment_alert(varchar,varchar,uuid,text,jsonb) TO qingyu_api;

INSERT INTO app.schema_migrations(version, checksum)
VALUES ('0056_payment_event_retries_and_multiple_receipts', 'payment-event-retries-multiple-receipts-v1')
ON CONFLICT (version) DO NOTHING;
COMMIT;
