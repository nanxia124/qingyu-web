-- 管理员账号进入业务库，避免管理员密码只存在服务器本地文件，换机或恢复时丢失。
BEGIN;
SELECT pg_advisory_xact_lock(70420260923);

CREATE TABLE IF NOT EXISTS app.admin_accounts (
    username varchar(64) PRIMARY KEY,
    password_hash varchar(128) NOT NULL,
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
    last_login_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS admin_accounts_status_idx ON app.admin_accounts(status, username);
GRANT SELECT, INSERT, UPDATE ON app.admin_accounts TO qingyu_api;
REVOKE ALL ON app.admin_accounts FROM qingyu_app;

INSERT INTO app.schema_migrations(version, checksum)
VALUES ('0054_admin_accounts', 'admin-accounts-v1')
ON CONFLICT (version) DO NOTHING;
COMMIT;
