-- 订阅价格快照、额度账户和预占/结算/释放事务。
-- 价格与额度都是业务事实；不删除历史流水，只追加新流水。
BEGIN;
SELECT pg_advisory_xact_lock(70420260923);

CREATE TABLE IF NOT EXISTS app.plan_versions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_id uuid NOT NULL REFERENCES app.plans(id) ON DELETE RESTRICT,
    version integer NOT NULL CHECK (version > 0),
    currency varchar(3) NOT NULL,
    price_minor bigint NOT NULL CHECK (price_minor >= 0),
    billing_interval text NOT NULL CHECK (billing_interval IN ('none','month','year')),
    feature_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
    quota_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
    effective_at timestamptz NOT NULL,
    retired_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (plan_id, version),
    CHECK (retired_at IS NULL OR retired_at > effective_at)
);

ALTER TABLE app.subscriptions ADD COLUMN IF NOT EXISTS plan_version_id uuid;
ALTER TABLE app.subscriptions ADD CONSTRAINT subscriptions_plan_version_fk
    FOREIGN KEY (plan_version_id) REFERENCES app.plan_versions(id) ON DELETE RESTRICT;
ALTER TABLE app.orders ADD COLUMN IF NOT EXISTS plan_version_id uuid;
ALTER TABLE app.orders ADD CONSTRAINT orders_plan_version_fk
    FOREIGN KEY (plan_version_id) REFERENCES app.plan_versions(id) ON DELETE RESTRICT;
ALTER TABLE app.orders ADD COLUMN IF NOT EXISTS price_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS app.quota_accounts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES app.workspaces(id) ON DELETE RESTRICT,
    quota_code varchar(120) NOT NULL,
    granted numeric(20,6) NOT NULL DEFAULT 0 CHECK (granted >= 0),
    reserved numeric(20,6) NOT NULL DEFAULT 0 CHECK (reserved >= 0),
    consumed numeric(20,6) NOT NULL DEFAULT 0 CHECK (consumed >= 0),
    available numeric(20,6) GENERATED ALWAYS AS (granted - reserved - consumed) STORED,
    version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, quota_code),
    UNIQUE (id, workspace_id),
    CHECK (reserved + consumed <= granted)
);

CREATE TABLE IF NOT EXISTS app.quota_reservations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id uuid NOT NULL REFERENCES app.quota_accounts(id) ON DELETE RESTRICT,
    workspace_id uuid NOT NULL REFERENCES app.workspaces(id) ON DELETE RESTRICT,
    quota_code varchar(120) NOT NULL,
    amount numeric(20,6) NOT NULL CHECK (amount > 0),
    status text NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved','committed','released','expired')),
    idempotency_key varchar(160) NOT NULL UNIQUE,
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    settled_at timestamptz,
    UNIQUE (id, workspace_id),
    FOREIGN KEY (account_id, workspace_id) REFERENCES app.quota_accounts(id, workspace_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS app.quota_ledger (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id uuid NOT NULL REFERENCES app.quota_accounts(id) ON DELETE RESTRICT,
    workspace_id uuid NOT NULL REFERENCES app.workspaces(id) ON DELETE RESTRICT,
    reservation_id uuid,
    entry_type text NOT NULL CHECK (entry_type IN ('grant','reserve','commit','release','expire','refund','adjustment')),
    amount numeric(20,6) NOT NULL CHECK (amount > 0),
    idempotency_key varchar(160) NOT NULL UNIQUE,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (account_id, workspace_id) REFERENCES app.quota_accounts(id, workspace_id) ON DELETE RESTRICT,
    FOREIGN KEY (reservation_id, workspace_id) REFERENCES app.quota_reservations(id, workspace_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS quota_reservations_expiry_idx ON app.quota_reservations(status, expires_at);
CREATE INDEX IF NOT EXISTS quota_ledger_account_idx ON app.quota_ledger(account_id, created_at);

CREATE OR REPLACE FUNCTION app.prevent_quota_ledger_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'quota_ledger 只允许追加，不能修改或删除';
END $$;
DROP TRIGGER IF EXISTS quota_ledger_immutable ON app.quota_ledger;
CREATE TRIGGER quota_ledger_immutable
    BEFORE UPDATE OR DELETE ON app.quota_ledger
    FOR EACH ROW EXECUTE FUNCTION app.prevent_quota_ledger_mutation();

CREATE OR REPLACE FUNCTION app.reserve_quota(
    p_workspace_id uuid, p_quota_code varchar, p_amount numeric,
    p_idempotency_key varchar, p_expires_at timestamptz
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE a app.quota_accounts%ROWTYPE; r app.quota_reservations%ROWTYPE;
BEGIN
    IF NOT app.has_workspace_access(p_workspace_id) THEN RAISE EXCEPTION '无权访问工作空间'; END IF;
    IF p_amount IS NULL OR p_amount <= 0 OR p_idempotency_key IS NULL OR p_expires_at <= now() THEN
        RAISE EXCEPTION '额度预占参数无效';
    END IF;
    SELECT * INTO r FROM app.quota_reservations WHERE idempotency_key = p_idempotency_key;
    IF FOUND THEN RETURN r.id; END IF;
    SELECT * INTO a FROM app.quota_accounts
      WHERE workspace_id=p_workspace_id AND quota_code=p_quota_code FOR UPDATE;
    IF NOT FOUND OR a.available < p_amount THEN RAISE EXCEPTION '额度不足'; END IF;
    UPDATE app.quota_accounts SET reserved=reserved+p_amount, version=version+1, updated_at=now() WHERE id=a.id;
    INSERT INTO app.quota_reservations(account_id,workspace_id,quota_code,amount,idempotency_key,expires_at)
      VALUES(a.id,p_workspace_id,p_quota_code,p_amount,p_idempotency_key,p_expires_at) RETURNING * INTO r;
    INSERT INTO app.quota_ledger(account_id,workspace_id,reservation_id,entry_type,amount,idempotency_key)
      VALUES(a.id,p_workspace_id,r.id,'reserve',p_amount,'reserve:'||p_idempotency_key);
    RETURN r.id;
END $$;

CREATE OR REPLACE FUNCTION app.settle_quota(p_reservation_id uuid, p_idempotency_key varchar)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE r app.quota_reservations%ROWTYPE; a app.quota_accounts%ROWTYPE;
BEGIN
    SELECT * INTO r FROM app.quota_reservations WHERE id=p_reservation_id FOR UPDATE;
    IF NOT FOUND OR NOT app.has_workspace_access(r.workspace_id) THEN RAISE EXCEPTION '预占不存在或无权访问'; END IF;
    IF r.status='committed' THEN RETURN true; END IF;
    IF r.status <> 'reserved' OR r.expires_at <= now() THEN RAISE EXCEPTION '预占已失效'; END IF;
    SELECT * INTO a FROM app.quota_accounts WHERE id=r.account_id FOR UPDATE;
    UPDATE app.quota_accounts SET reserved=reserved-r.amount, consumed=consumed+r.amount, version=version+1, updated_at=now() WHERE id=a.id;
    UPDATE app.quota_reservations SET status='committed', settled_at=now() WHERE id=r.id;
    INSERT INTO app.quota_ledger(account_id,workspace_id,reservation_id,entry_type,amount,idempotency_key)
      VALUES(r.account_id,r.workspace_id,r.id,'commit',r.amount,'commit:'||p_idempotency_key)
      ON CONFLICT (idempotency_key) DO NOTHING;
    RETURN true;
END $$;

CREATE OR REPLACE FUNCTION app.release_quota(p_reservation_id uuid, p_idempotency_key varchar)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE r app.quota_reservations%ROWTYPE;
BEGIN
    SELECT * INTO r FROM app.quota_reservations WHERE id=p_reservation_id FOR UPDATE;
    IF NOT FOUND OR NOT app.has_workspace_access(r.workspace_id) THEN RAISE EXCEPTION '预占不存在或无权访问'; END IF;
    IF r.status='released' OR r.status='expired' THEN RETURN true; END IF;
    IF r.status <> 'reserved' THEN RAISE EXCEPTION '已结算的预占不能释放'; END IF;
    UPDATE app.quota_accounts SET reserved=reserved-r.amount, version=version+1, updated_at=now() WHERE id=r.account_id;
    UPDATE app.quota_reservations SET status='released', settled_at=now() WHERE id=r.id;
    INSERT INTO app.quota_ledger(account_id,workspace_id,reservation_id,entry_type,amount,idempotency_key)
      VALUES(r.account_id,r.workspace_id,r.id,'release',r.amount,'release:'||p_idempotency_key)
      ON CONFLICT (idempotency_key) DO NOTHING;
    RETURN true;
END $$;

REVOKE ALL ON app.plan_versions, app.quota_accounts, app.quota_reservations, app.quota_ledger FROM qingyu_app;
REVOKE ALL ON FUNCTION app.reserve_quota(uuid,varchar,numeric,varchar,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.settle_quota(uuid,varchar) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.release_quota(uuid,varchar) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.reserve_quota(uuid,varchar,numeric,varchar,timestamptz) TO qingyu_app;
GRANT EXECUTE ON FUNCTION app.settle_quota(uuid,varchar) TO qingyu_app;
GRANT EXECUTE ON FUNCTION app.release_quota(uuid,varchar) TO qingyu_app;

INSERT INTO app.schema_migrations(version, checksum)
VALUES ('0010_billing_consistency', 'billing-consistency-v1')
ON CONFLICT (version) DO NOTHING;
COMMIT;
