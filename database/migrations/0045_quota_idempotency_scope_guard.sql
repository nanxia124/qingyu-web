-- 额度预占的幂等键必须绑定原始业务范围，禁止跨空间、跨额度类型或跨用户复用。
BEGIN;
SELECT pg_advisory_xact_lock(70420260923);

CREATE OR REPLACE FUNCTION app.reserve_quota(
    p_workspace_id uuid, p_quota_code varchar, p_amount numeric,
    p_idempotency_key varchar, p_expires_at timestamptz
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
    a app.quota_accounts%ROWTYPE;
    r app.quota_reservations%ROWTYPE;
BEGIN
    IF NOT app.has_workspace_access(p_workspace_id) THEN
        RAISE EXCEPTION '无权访问工作空间';
    END IF;
    IF p_amount IS NULL OR p_amount <= 0 OR p_idempotency_key IS NULL OR p_expires_at <= now() THEN
        RAISE EXCEPTION '额度预占参数无效';
    END IF;

    SELECT * INTO r FROM app.quota_reservations WHERE idempotency_key = p_idempotency_key;
    IF FOUND THEN
        IF r.workspace_id IS DISTINCT FROM p_workspace_id
           OR r.quota_code IS DISTINCT FROM p_quota_code
           OR r.amount IS DISTINCT FROM p_amount THEN
            RAISE EXCEPTION '额度预占幂等键已用于其他工作空间、额度类型或金额';
        END IF;
        RETURN r.id;
    END IF;

    SELECT * INTO a FROM app.quota_accounts
    WHERE workspace_id=p_workspace_id AND quota_code=p_quota_code FOR UPDATE;
    IF NOT FOUND OR a.available < p_amount THEN
        RAISE EXCEPTION '额度不足';
    END IF;
    UPDATE app.quota_accounts
       SET reserved=reserved+p_amount, version=version+1, updated_at=now()
     WHERE id=a.id;
    INSERT INTO app.quota_reservations(account_id,workspace_id,quota_code,amount,idempotency_key,expires_at)
      VALUES(a.id,p_workspace_id,p_quota_code,p_amount,p_idempotency_key,p_expires_at)
      RETURNING * INTO r;
    INSERT INTO app.quota_ledger(account_id,workspace_id,reservation_id,entry_type,amount,idempotency_key)
      VALUES(a.id,p_workspace_id,r.id,'reserve',p_amount,'reserve:'||p_idempotency_key);
    RETURN r.id;
END;
$$;

CREATE OR REPLACE FUNCTION app.reserve_free_daily_usage(
    p_workspace_id uuid, p_user_id uuid, p_feature_code varchar,
    p_amount numeric, p_idempotency_key varchar, p_daily_limit numeric,
    p_expires_at timestamptz
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
    r app.daily_usage_reservations%ROWTYPE;
    used_amount numeric;
BEGIN
    IF app.current_user_id() IS DISTINCT FROM p_user_id OR NOT app.has_workspace_access(p_workspace_id) THEN
        RAISE EXCEPTION '无权访问工作空间';
    END IF;
    IF p_amount IS NULL OR p_amount <= 0 OR p_daily_limit IS NULL OR p_daily_limit <= 0
       OR p_idempotency_key IS NULL OR p_expires_at <= now() THEN
        RAISE EXCEPTION '免费额度预占参数无效';
    END IF;

    SELECT * INTO r FROM app.daily_usage_reservations WHERE idempotency_key=p_idempotency_key;
    IF FOUND THEN
        IF r.workspace_id IS DISTINCT FROM p_workspace_id
           OR r.user_id IS DISTINCT FROM p_user_id
           OR r.feature_code IS DISTINCT FROM p_feature_code
           OR r.amount IS DISTINCT FROM p_amount
           OR r.usage_date IS DISTINCT FROM current_date THEN
            RAISE EXCEPTION '免费额度幂等键已用于其他工作空间、用户、功能或金额';
        END IF;
        RETURN r.id;
    END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text || ':' || p_workspace_id::text || ':' || current_date::text || ':' || p_feature_code, 70420260923));
    SELECT * INTO r FROM app.daily_usage_reservations WHERE idempotency_key=p_idempotency_key;
    IF FOUND THEN
        IF r.workspace_id IS DISTINCT FROM p_workspace_id
           OR r.user_id IS DISTINCT FROM p_user_id
           OR r.feature_code IS DISTINCT FROM p_feature_code
           OR r.amount IS DISTINCT FROM p_amount
           OR r.usage_date IS DISTINCT FROM current_date THEN
            RAISE EXCEPTION '免费额度幂等键已用于其他工作空间、用户、功能或金额';
        END IF;
        RETURN r.id;
    END IF;

    SELECT coalesce(sum(amount),0) INTO used_amount
      FROM app.daily_usage_reservations
     WHERE user_id=p_user_id AND workspace_id=p_workspace_id AND usage_date=current_date
       AND feature_code=p_feature_code AND status IN ('reserved','committed');
    IF used_amount + p_amount > p_daily_limit THEN
        RAISE EXCEPTION '今日免费额度已用完';
    END IF;
    INSERT INTO app.daily_usage_reservations(workspace_id,user_id,usage_date,feature_code,amount,idempotency_key,expires_at)
      VALUES(p_workspace_id,p_user_id,current_date,p_feature_code,p_amount,p_idempotency_key,p_expires_at)
      RETURNING * INTO r;
    RETURN r.id;
END;
$$;

INSERT INTO app.schema_migrations(version, checksum)
VALUES ('0045_quota_idempotency_scope_guard', 'quota-idempotency-scope-guard-v1')
ON CONFLICT (version) DO NOTHING;
COMMIT;
