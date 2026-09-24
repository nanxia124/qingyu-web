-- 支付事件、订单、付款记录和退款申请必须保持同一业务对象关系。
BEGIN;
SELECT pg_advisory_xact_lock(70420260923);

CREATE OR REPLACE FUNCTION app.validate_payment_event_order_payment()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.payment_id IS NOT NULL AND NEW.order_id IS NOT NULL
       AND NOT EXISTS (
           SELECT 1 FROM app.payments p
            WHERE p.id=NEW.payment_id AND p.order_id=NEW.order_id
       ) THEN
        RAISE EXCEPTION '支付事件的付款记录和订单不匹配';
    END IF;
    RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS payment_event_order_payment_guard ON app.payment_events;
CREATE CONSTRAINT TRIGGER payment_event_order_payment_guard
AFTER INSERT OR UPDATE ON app.payment_events
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION app.validate_payment_event_order_payment();

CREATE OR REPLACE FUNCTION app.validate_refund_order_workspace()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE order_workspace uuid; payment_order uuid;
BEGIN
    SELECT workspace_id INTO order_workspace FROM app.orders WHERE id=NEW.order_id;
    IF order_workspace IS NULL OR order_workspace <> NEW.workspace_id THEN
        RAISE EXCEPTION '退款申请和订单不属于同一工作空间';
    END IF;
    SELECT order_id INTO payment_order FROM app.payments WHERE id=NEW.payment_id;
    IF payment_order IS NULL OR payment_order <> NEW.order_id THEN
        RAISE EXCEPTION '退款申请的付款记录和订单不匹配';
    END IF;
    RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS refund_order_workspace_guard ON app.refunds;
CREATE CONSTRAINT TRIGGER refund_order_workspace_guard
AFTER INSERT OR UPDATE ON app.refunds
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION app.validate_refund_order_workspace();

INSERT INTO app.schema_migrations(version, checksum)
VALUES ('0036_payment_refund_scope_integrity', 'payment-refund-scope-integrity-v1')
ON CONFLICT (version) DO NOTHING;
COMMIT;
