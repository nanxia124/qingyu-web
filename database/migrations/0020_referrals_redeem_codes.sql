-- 邀请关系和兑换码业务事实，避免正式环境继续使用 JSON 账本。
BEGIN;

SELECT pg_advisory_xact_lock(70420260923);

ALTER TABLE app.user_accounts
    ADD COLUMN IF NOT EXISTS invited_by_user_id uuid REFERENCES app.user_accounts(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS user_accounts_invited_by_idx ON app.user_accounts(invited_by_user_id);

CREATE TABLE IF NOT EXISTS app.redeem_codes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code varchar(160) NOT NULL UNIQUE,
    kind text NOT NULL CHECK (kind IN ('quota','membership')),
    denomination numeric(20,6) NOT NULL DEFAULT 0 CHECK (denomination >= 0),
    plan_id uuid REFERENCES app.plans(id) ON DELETE RESTRICT,
    batch varchar(120),
    expires_at timestamptz,
    used_by uuid REFERENCES app.user_accounts(id) ON DELETE RESTRICT,
    used_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK ((kind='quota' AND denomination > 0 AND plan_id IS NULL)
        OR (kind='membership' AND plan_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS redeem_codes_status_idx ON app.redeem_codes(used_by, expires_at);

INSERT INTO app.schema_migrations(version, checksum)
VALUES ('0020_referrals_redeem_codes', 'referrals-redeem-codes-v1')
ON CONFLICT (version) DO NOTHING;
COMMIT;
