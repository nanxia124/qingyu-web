-- 支付事实的数据库兜底：同一待付款意图只能有一单，同一订单不能重复成功。
BEGIN;
SELECT pg_advisory_xact_lock(70420260923);

CREATE UNIQUE INDEX orders_one_pending_per_workspace_plan
    ON app.orders(workspace_id, plan_id)
    WHERE status = 'pending' AND plan_id IS NOT NULL;

CREATE UNIQUE INDEX payments_one_success_per_order
    ON app.payments(order_id)
    WHERE status = 'succeeded';

CREATE UNIQUE INDEX payments_one_active_attempt_per_order_provider
    ON app.payments(order_id, provider)
    WHERE status IN ('pending','succeeded');

CREATE OR REPLACE FUNCTION app.validate_payment_amount()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE order_amount bigint;
BEGIN
    SELECT amount_minor INTO order_amount FROM app.orders WHERE id = NEW.order_id;
    IF order_amount IS NULL THEN
        RAISE EXCEPTION '支付对应的订单不存在';
    END IF;
    IF NEW.amount_minor <> order_amount THEN
        RAISE EXCEPTION '支付金额和订单金额不一致';
    END IF;
    RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS payment_amount_check ON app.payments;
CREATE TRIGGER payment_amount_check
BEFORE INSERT OR UPDATE OF order_id, amount_minor ON app.payments
FOR EACH ROW EXECUTE FUNCTION app.validate_payment_amount();

CREATE OR REPLACE FUNCTION app.prevent_paid_order_regression()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.status IN ('paid','partially_refunded','refunded')
       AND NEW.status NOT IN ('paid','partially_refunded','refunded') THEN
        RAISE EXCEPTION '已完成的订单不能退回待付款或失败状态';
    END IF;
    RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS paid_order_regression_check ON app.orders;
CREATE TRIGGER paid_order_regression_check
BEFORE UPDATE OF status ON app.orders
FOR EACH ROW EXECUTE FUNCTION app.prevent_paid_order_regression();

INSERT INTO app.schema_migrations(version, checksum)
VALUES ('0019_payment_idempotency', 'payment-idempotency-v1')
ON CONFLICT (version) DO NOTHING;
COMMIT;
