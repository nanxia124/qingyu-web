-- 直接写库时也必须拒绝超额退款；测试结束回滚，不留下业务数据。
BEGIN;

DO $$
DECLARE
    uid uuid;
    wid uuid;
    pid uuid;
    ver uuid;
    oid uuid;
    payid uuid;
    duplicate_payid uuid;
    rejected boolean := false;
BEGIN
    INSERT INTO app.user_accounts(appwrite_user_id)
    VALUES ('refund-guard-test-' || gen_random_uuid())
    RETURNING id INTO uid;
    INSERT INTO app.workspaces(type, owner_user_id, name)
    VALUES ('personal', uid, '退款约束测试空间')
    RETURNING id INTO wid;
    INSERT INTO app.plans(code, name, currency, price_minor, billing_interval, status)
    VALUES ('refund-guard-' || substr(gen_random_uuid()::text, 1, 8), '退款约束测试套餐', 'CNY', 1000, 'none', 'active')
    RETURNING id INTO pid;
    INSERT INTO app.plan_versions(plan_id, version, currency, price_minor, billing_interval, effective_at)
    VALUES (pid, 1, 'CNY', 1000, 'none', now())
    RETURNING id INTO ver;
    INSERT INTO app.orders(workspace_id, plan_id, plan_version_id, order_no, status, currency, amount_minor, idempotency_key)
    VALUES (wid, pid, ver, 'REFUND-GUARD-' || gen_random_uuid(), 'paid', 'CNY', 1000, 'refund-guard-order-' || gen_random_uuid())
    RETURNING id INTO oid;
    INSERT INTO app.payments(order_id, provider, provider_payment_id, status, amount_minor, currency, paid_at)
    VALUES (oid, 'test', 'refund-guard-payment-' || gen_random_uuid(), 'succeeded', 1000, 'CNY', now())
    RETURNING id INTO payid;
    INSERT INTO app.payments(order_id, provider, provider_payment_id, status, amount_minor, currency, paid_at)
    VALUES (oid, 'test', 'refund-guard-duplicate-payment-' || gen_random_uuid(), 'succeeded', 1000, 'CNY', now()+interval '1 second')
    RETURNING id INTO duplicate_payid;
    INSERT INTO app.refunds(workspace_id, order_id, payment_id, amount_minor, currency, idempotency_key, reason, requested_by)
    VALUES (wid, oid, payid, 600, 'CNY', 'refund-guard-first-' || gen_random_uuid(), '第一笔退款', uid);

    SET CONSTRAINTS app.refund_order_workspace_guard, app.refund_amount_total_guard IMMEDIATE;
    INSERT INTO app.refunds(workspace_id, order_id, payment_id, refund_kind, amount_minor, currency, idempotency_key, reason, requested_by)
    VALUES (wid, oid, duplicate_payid, 'duplicate_collection', 1000, 'CNY', 'refund-guard-duplicate-' || gen_random_uuid(), '退回重复收款', uid);
    BEGIN
        INSERT INTO app.refunds(workspace_id, order_id, payment_id, amount_minor, currency, idempotency_key, reason, requested_by)
        VALUES (wid, oid, payid, 500, 'CNY', 'refund-guard-second-' || gen_random_uuid(), '超额退款', uid);
    EXCEPTION WHEN others THEN
        IF SQLERRM LIKE '%对应收款的退款累计金额超过已收金额%' OR SQLERRM LIKE '%单笔退款金额超过对应收款金额%' THEN
            rejected := true;
        ELSE
            RAISE;
        END IF;
    END;
    IF NOT rejected THEN
        RAISE EXCEPTION '数据库没有拒绝累计超额退款';
    END IF;
    IF (SELECT sum(amount_minor) FROM app.refunds WHERE order_id=oid) <= 1000 THEN
        RAISE EXCEPTION '重复收款退款测试没有覆盖超过订单金额的合计退款';
    END IF;
END;
$$;

ROLLBACK;
