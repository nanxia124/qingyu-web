-- 退款金额和退款累计值必须受订单金额约束，退款事实建立后金额和归属不可篡改。
BEGIN;
SELECT pg_advisory_xact_lock(70420260923);

CREATE OR REPLACE FUNCTION app.validate_refund_amount_total()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    order_amount bigint;
    order_currency varchar(3);
    refund_total bigint;
BEGIN
    SELECT amount_minor, currency
      INTO order_amount, order_currency
    FROM app.orders
    WHERE id = NEW.order_id;

    IF order_amount IS NULL THEN
        RAISE EXCEPTION '退款对应的订单不存在';
    END IF;
    IF NEW.amount_minor > order_amount THEN
        RAISE EXCEPTION '单笔退款金额超过订单金额';
    END IF;
    IF upper(NEW.currency) <> upper(order_currency) THEN
        RAISE EXCEPTION '退款币种和订单币种不一致';
    END IF;

    SELECT coalesce(sum(amount_minor), 0)
      INTO refund_total
    FROM app.refunds
    WHERE order_id = NEW.order_id
      AND status IN ('pending', 'processing', 'succeeded', 'unknown');

    IF refund_total > order_amount THEN
        RAISE EXCEPTION '退款累计金额超过订单金额';
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION app.prevent_refund_identity_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.workspace_id <> OLD.workspace_id
       OR NEW.order_id <> OLD.order_id
       OR NEW.payment_id IS DISTINCT FROM OLD.payment_id
       OR NEW.amount_minor <> OLD.amount_minor
       OR NEW.currency <> OLD.currency
       OR NEW.idempotency_key <> OLD.idempotency_key THEN
        RAISE EXCEPTION '退款申请的订单、金额、币种和幂等键建立后不能修改';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS refund_identity_immutable ON app.refunds;
CREATE TRIGGER refund_identity_immutable
BEFORE UPDATE ON app.refunds
FOR EACH ROW EXECUTE FUNCTION app.prevent_refund_identity_change();

DROP TRIGGER IF EXISTS refund_amount_total_guard ON app.refunds;
CREATE CONSTRAINT TRIGGER refund_amount_total_guard
AFTER INSERT OR UPDATE
ON app.refunds
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION app.validate_refund_amount_total();

INSERT INTO app.schema_migrations(version, checksum)
VALUES ('0044_refund_amount_guard', 'refund-amount-guard-v1')
ON CONFLICT (version) DO NOTHING;
COMMIT;
