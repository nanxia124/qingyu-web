-- 验证管理员账号可以持久化，并且停用状态不会被误当作可用账号。
BEGIN;
INSERT INTO app.admin_accounts(username, password_hash) VALUES ('admin-test', repeat('a', 64));
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM app.admin_accounts WHERE username='admin-test' AND status='active') THEN
        RAISE EXCEPTION '管理员账号没有正确写入';
    END IF;
    UPDATE app.admin_accounts SET status='disabled' WHERE username='admin-test';
    IF EXISTS (SELECT 1 FROM app.admin_accounts WHERE username='admin-test' AND status='active') THEN
        RAISE EXCEPTION '停用管理员仍然显示为可用';
    END IF;
    RAISE NOTICE 'PASS: 管理员账号持久化和停用状态有效';
END;
$$;
ROLLBACK;
