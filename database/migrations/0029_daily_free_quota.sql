-- 免费版每日调用额度：按用户、工作空间、日期和功能隔离，并支持预占/结算/释放。
BEGIN;
SELECT pg_advisory_xact_lock(70420260923);

CREATE TABLE IF NOT EXISTS app.daily_usage_reservations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES app.workspaces(id) ON DELETE RESTRICT,
    user_id uuid NOT NULL REFERENCES app.user_accounts(id) ON DELETE RESTRICT,
    usage_date date NOT NULL,
    feature_code varchar(120) NOT NULL,
    amount numeric(20,6) NOT NULL CHECK (amount > 0),
    status text NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved','committed','released','expired')),
    idempotency_key varchar(160) NOT NULL UNIQUE,
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    settled_at timestamptz
);

CREATE INDEX IF NOT EXISTS daily_usage_reservations_lookup_idx
    ON app.daily_usage_reservations(user_id, workspace_id, usage_date, feature_code, status);

ALTER TABLE app.daily_usage_reservations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS workspace_isolation ON app.daily_usage_reservations;
CREATE POLICY workspace_isolation ON app.daily_usage_reservations
    USING (app.has_workspace_access(workspace_id))
    WITH CHECK (app.has_workspace_access(workspace_id));

ALTER TABLE app.usage_records
    ADD COLUMN IF NOT EXISTS daily_reservation_id uuid;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'usage_records_daily_reservation_fk'
          AND conrelid = 'app.usage_records'::regclass
    ) THEN
        ALTER TABLE app.usage_records
            ADD CONSTRAINT usage_records_daily_reservation_fk
            FOREIGN KEY (daily_reservation_id)
            REFERENCES app.daily_usage_reservations(id)
            ON DELETE RESTRICT;
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS usage_records_daily_reservation_idx
    ON app.usage_records(daily_reservation_id)
    WHERE daily_reservation_id IS NOT NULL;

CREATE OR REPLACE FUNCTION app.reserve_free_daily_usage(
    p_workspace_id uuid, p_user_id uuid, p_feature_code varchar,
    p_amount numeric, p_idempotency_key varchar, p_daily_limit numeric,
    p_expires_at timestamptz
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE r app.daily_usage_reservations%ROWTYPE; used_amount numeric;
BEGIN
    IF app.current_user_id() IS DISTINCT FROM p_user_id OR NOT app.has_workspace_access(p_workspace_id) THEN
        RAISE EXCEPTION '无权访问工作空间';
    END IF;
    IF p_amount IS NULL OR p_amount <= 0 OR p_daily_limit IS NULL OR p_daily_limit <= 0
       OR p_idempotency_key IS NULL OR p_expires_at <= now() THEN
        RAISE EXCEPTION '免费额度预占参数无效';
    END IF;
    SELECT * INTO r FROM app.daily_usage_reservations WHERE idempotency_key=p_idempotency_key;
    IF FOUND THEN RETURN r.id; END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text || ':' || p_workspace_id::text || ':' || current_date::text || ':' || p_feature_code, 70420260923));
    -- 另一个相同请求可能刚刚提交，拿到锁后必须再次读取幂等键。
    SELECT * INTO r FROM app.daily_usage_reservations WHERE idempotency_key=p_idempotency_key;
    IF FOUND THEN RETURN r.id; END IF;
    SELECT coalesce(sum(amount),0) INTO used_amount
      FROM app.daily_usage_reservations
      WHERE user_id=p_user_id AND workspace_id=p_workspace_id AND usage_date=current_date
        AND feature_code=p_feature_code AND status IN ('reserved','committed');
    IF used_amount + p_amount > p_daily_limit THEN RAISE EXCEPTION '今日免费额度已用完'; END IF;
    INSERT INTO app.daily_usage_reservations(workspace_id,user_id,usage_date,feature_code,amount,idempotency_key,expires_at)
      VALUES(p_workspace_id,p_user_id,current_date,p_feature_code,p_amount,p_idempotency_key,p_expires_at)
      RETURNING * INTO r;
    RETURN r.id;
END $$;

CREATE OR REPLACE FUNCTION app.settle_free_daily_usage(p_reservation_id uuid, p_idempotency_key varchar)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE r app.daily_usage_reservations%ROWTYPE;
BEGIN
    SELECT * INTO r FROM app.daily_usage_reservations WHERE id=p_reservation_id FOR UPDATE;
    IF NOT FOUND OR app.current_user_id() IS DISTINCT FROM r.user_id OR NOT app.has_workspace_access(r.workspace_id) THEN
        RAISE EXCEPTION '免费额度预占不存在或无权访问';
    END IF;
    IF r.status='committed' THEN RETURN true; END IF;
    IF r.status <> 'reserved' OR r.expires_at <= now() THEN RAISE EXCEPTION '免费额度预占已失效'; END IF;
    UPDATE app.daily_usage_reservations SET status='committed',settled_at=now() WHERE id=r.id;
    RETURN true;
END $$;

CREATE OR REPLACE FUNCTION app.release_free_daily_usage(p_reservation_id uuid, p_idempotency_key varchar)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE r app.daily_usage_reservations%ROWTYPE;
BEGIN
    SELECT * INTO r FROM app.daily_usage_reservations WHERE id=p_reservation_id FOR UPDATE;
    IF NOT FOUND OR app.current_user_id() IS DISTINCT FROM r.user_id OR NOT app.has_workspace_access(r.workspace_id) THEN
        RAISE EXCEPTION '免费额度预占不存在或无权访问';
    END IF;
    IF r.status IN ('released','expired') THEN RETURN true; END IF;
    IF r.status <> 'reserved' THEN RAISE EXCEPTION '已结算的免费额度不能释放'; END IF;
    UPDATE app.daily_usage_reservations SET status='released',settled_at=now() WHERE id=r.id;
    RETURN true;
END $$;

GRANT EXECUTE ON FUNCTION app.reserve_free_daily_usage(uuid,uuid,varchar,numeric,varchar,numeric,timestamptz) TO qingyu_api;
GRANT EXECUTE ON FUNCTION app.settle_free_daily_usage(uuid,varchar) TO qingyu_api;
GRANT EXECUTE ON FUNCTION app.release_free_daily_usage(uuid,varchar) TO qingyu_api;

INSERT INTO app.schema_migrations(version, checksum)
VALUES ('0029_daily_free_quota', 'daily-free-quota-v1')
ON CONFLICT (version) DO NOTHING;
COMMIT;
