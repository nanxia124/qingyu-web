-- 每笔退款绑定一笔真实收款，避免把重复收款退款误算成整张订单退款。
BEGIN;
SELECT pg_advisory_xact_lock(70420260957);

ALTER TABLE app.refunds
    ADD COLUMN IF NOT EXISTS refund_kind text NOT NULL DEFAULT 'purchase_refund';
ALTER TABLE app.refunds DROP CONSTRAINT IF EXISTS refunds_refund_kind_check;
ALTER TABLE app.refunds ADD CONSTRAINT refunds_refund_kind_check
    CHECK (refund_kind IN ('purchase_refund','duplicate_collection'));

CREATE OR REPLACE FUNCTION app.lock_refund_payment_receipt()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    PERFORM 1 FROM app.payments WHERE id=NEW.payment_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION '退款对应的实收记录不存在'; END IF;
    RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS refund_payment_receipt_lock ON app.refunds;
CREATE TRIGGER refund_payment_receipt_lock
BEFORE INSERT OR UPDATE OF payment_id ON app.refunds
FOR EACH ROW EXECUTE FUNCTION app.lock_refund_payment_receipt();

CREATE OR REPLACE FUNCTION app.validate_refund_amount_total()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    order_amount bigint;
    receipt_amount bigint;
    receipt_currency varchar(3);
    receipt_order uuid;
    receipt_status text;
    refund_total bigint;
    successful_receipt_count integer;
BEGIN
    SELECT amount_minor INTO order_amount
      FROM app.orders WHERE id=NEW.order_id;
    IF order_amount IS NULL THEN RAISE EXCEPTION '退款对应的订单不存在'; END IF;
    SELECT amount_minor,currency,order_id,status INTO receipt_amount,receipt_currency,receipt_order,receipt_status
      FROM app.payments WHERE id=NEW.payment_id;
    IF receipt_amount IS NULL OR receipt_order<>NEW.order_id OR receipt_status<>'succeeded' THEN
        RAISE EXCEPTION '退款必须关联同一订单的成功收款';
    END IF;
    IF NEW.amount_minor>receipt_amount THEN
        RAISE EXCEPTION '单笔退款金额超过对应收款金额';
    END IF;
    IF upper(NEW.currency)<>upper(receipt_currency) THEN
        RAISE EXCEPTION '退款币种和对应收款币种不一致';
    END IF;
    IF NEW.refund_kind='duplicate_collection' THEN
        SELECT count(*) INTO successful_receipt_count FROM app.payments
          WHERE order_id=NEW.order_id AND status='succeeded';
        IF successful_receipt_count<2 THEN
            RAISE EXCEPTION '重复收款退款必须关联确实存在的第二笔或后续收款';
        END IF;
    END IF;
    SELECT coalesce(sum(amount_minor),0) INTO refund_total FROM app.refunds
      WHERE payment_id=NEW.payment_id AND status IN ('pending','processing','succeeded','unknown');
    IF refund_total>receipt_amount THEN
        RAISE EXCEPTION '对应收款的退款累计金额超过已收金额';
    END IF;
    RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION app.prevent_refund_identity_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.workspace_id<>OLD.workspace_id
       OR NEW.order_id<>OLD.order_id
       OR NEW.payment_id IS DISTINCT FROM OLD.payment_id
       OR NEW.refund_kind<>OLD.refund_kind
       OR NEW.amount_minor<>OLD.amount_minor
       OR NEW.currency<>OLD.currency
       OR NEW.idempotency_key<>OLD.idempotency_key THEN
        RAISE EXCEPTION '退款申请的订单、收款、类型、金额、币种和幂等键建立后不能修改';
    END IF;
    RETURN NEW;
END $$;

INSERT INTO app.schema_migrations(version, checksum)
VALUES ('0057_refunds_scoped_to_receipts', 'refunds-scoped-to-receipts-v1')
ON CONFLICT (version) DO NOTHING;
COMMIT;
