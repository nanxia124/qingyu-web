-- 未知供应商结果的人工核对记录。核对前额度保持预占，核对后才结算或释放。
BEGIN;
SELECT pg_advisory_xact_lock(70420260923);

CREATE TABLE IF NOT EXISTS app.usage_reconciliations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    usage_record_id uuid NOT NULL UNIQUE REFERENCES app.usage_records(id) ON DELETE RESTRICT,
    workspace_id uuid NOT NULL REFERENCES app.workspaces(id) ON DELETE RESTRICT,
    actor_admin varchar(160) NOT NULL,
    decision text NOT NULL CHECK (decision IN ('committed','released')),
    reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 2000),
    provider_reference varchar(200) NOT NULL CHECK (length(btrim(provider_reference)) > 0),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS usage_reconciliation_workspace_idx
    ON app.usage_reconciliations(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS usage_records_unknown_idx
    ON app.usage_records(result, occurred_at DESC)
    WHERE result='unknown';

CREATE OR REPLACE FUNCTION app.prevent_usage_reconciliation_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'usage_reconciliations 只允许追加，不能修改或删除';
END $$;
DROP TRIGGER IF EXISTS usage_reconciliations_immutable ON app.usage_reconciliations;
CREATE TRIGGER usage_reconciliations_immutable
    BEFORE UPDATE OR DELETE ON app.usage_reconciliations
    FOR EACH ROW EXECUTE FUNCTION app.prevent_usage_reconciliation_mutation();
REVOKE ALL ON app.usage_reconciliations FROM PUBLIC, qingyu_app, qingyu_api;
GRANT SELECT ON app.usage_reconciliations TO qingyu_api;

-- 只对已经有明确供应商证据的未知记录操作，过期不等于失败。
CREATE OR REPLACE FUNCTION app.reconcile_provider_usage(
    p_usage_id uuid, p_actor text, p_decision text, p_reason text, p_reference text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE u app.usage_records%ROWTYPE; prior app.usage_reconciliations%ROWTYPE;
    q app.quota_reservations%ROWTYPE; d app.daily_usage_reservations%ROWTYPE; audit_id uuid;
BEGIN
    IF p_actor IS NULL OR length(btrim(p_actor)) NOT BETWEEN 1 AND 160
       OR p_decision IS NULL OR p_decision NOT IN ('committed','released')
       OR p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 1 AND 2000
       OR p_reference IS NULL OR length(btrim(p_reference)) NOT BETWEEN 1 AND 200 THEN
        RAISE EXCEPTION '必须提供管理员、有效结论、处理理由和供应商凭据';
    END IF;
    SELECT * INTO u FROM app.usage_records WHERE id=p_usage_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION '调用记录不存在'; END IF;
    SELECT * INTO prior FROM app.usage_reconciliations WHERE usage_record_id=u.id;
    IF FOUND THEN
        IF prior.decision<>p_decision THEN RAISE EXCEPTION '已有核对结论，不能覆盖'; END IF;
        RETURN prior.id;
    END IF;
    IF u.result<>'unknown' THEN RAISE EXCEPTION '只能核对未知结果'; END IF;
    IF u.quota_reservation_id IS NOT NULL AND u.daily_reservation_id IS NOT NULL THEN
        RAISE EXCEPTION '调用同时关联两类额度，需要先排查';
    END IF;
    IF u.quota_reservation_id IS NOT NULL THEN
        SELECT * INTO q FROM app.quota_reservations WHERE id=u.quota_reservation_id FOR UPDATE;
        IF NOT FOUND OR q.workspace_id<>u.workspace_id OR q.status<>'reserved' THEN
            RAISE EXCEPTION '额度预占归属或状态异常';
        END IF;
        UPDATE app.quota_accounts SET reserved=reserved-q.amount,
            consumed=consumed+CASE WHEN p_decision='committed' THEN q.amount ELSE 0 END,
            version=version+1,updated_at=now() WHERE id=q.account_id;
        UPDATE app.quota_reservations SET status=p_decision,settled_at=now() WHERE id=q.id;
        INSERT INTO app.quota_ledger(account_id,workspace_id,reservation_id,entry_type,amount,idempotency_key,metadata)
        VALUES(q.account_id,u.workspace_id,q.id,CASE WHEN p_decision='committed' THEN 'commit' ELSE 'release' END,
            q.amount,'reconcile:'||u.id::text,jsonb_build_object('actor',p_actor,'reason',p_reason,'provider_reference',p_reference));
    ELSIF u.daily_reservation_id IS NOT NULL THEN
        SELECT * INTO d FROM app.daily_usage_reservations WHERE id=u.daily_reservation_id FOR UPDATE;
        IF NOT FOUND OR d.workspace_id<>u.workspace_id OR d.user_id IS DISTINCT FROM u.user_id OR d.status<>'reserved' THEN
            RAISE EXCEPTION '免费额度预占归属或状态异常';
        END IF;
        UPDATE app.daily_usage_reservations SET status=p_decision,settled_at=now() WHERE id=d.id;
    END IF;
    INSERT INTO app.usage_reconciliations(usage_record_id,workspace_id,actor_admin,decision,reason,provider_reference)
        VALUES(u.id,u.workspace_id,p_actor,p_decision,btrim(p_reason),btrim(p_reference)) RETURNING id INTO audit_id;
    UPDATE app.usage_records SET result=CASE WHEN p_decision='committed' THEN 'committed' ELSE 'failed' END,
        metadata=metadata||jsonb_build_object('reconciliation_id',audit_id) WHERE id=u.id;
    RETURN audit_id;
END $$;
REVOKE ALL ON FUNCTION app.reconcile_provider_usage(uuid,text,text,text,text) FROM PUBLIC, qingyu_app;
GRANT EXECUTE ON FUNCTION app.reconcile_provider_usage(uuid,text,text,text,text) TO qingyu_api;

INSERT INTO app.schema_migrations(version, checksum)
VALUES ('0030_usage_reconciliation', 'usage-reconciliation-v1')
ON CONFLICT (version) DO NOTHING;
COMMIT;
