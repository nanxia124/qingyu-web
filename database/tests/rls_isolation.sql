\set ON_ERROR_STOP on
BEGIN;

INSERT INTO app.user_accounts(appwrite_user_id, display_name)
VALUES ('rls-test-a', 'RLS A'), ('rls-test-b', 'RLS B');
INSERT INTO app.workspaces(type, owner_user_id, name)
SELECT 'personal', id, 'RLS 空间 A' FROM app.user_accounts WHERE appwrite_user_id='rls-test-a';
INSERT INTO app.workspaces(type, owner_user_id, name)
SELECT 'personal', id, 'RLS 空间 B' FROM app.user_accounts WHERE appwrite_user_id='rls-test-b';
INSERT INTO app.assets(workspace_id, asset_type, title)
SELECT id, 'image', 'RLS 资产 A' FROM app.workspaces WHERE name='RLS 空间 A';
INSERT INTO app.assets(workspace_id, asset_type, title)
SELECT id, 'image', 'RLS 资产 B' FROM app.workspaces WHERE name='RLS 空间 B';
CREATE TEMP TABLE rls_ids (workspace_b uuid) ON COMMIT DROP;
INSERT INTO rls_ids(workspace_b) SELECT id FROM app.workspaces WHERE name='RLS 空间 B';
GRANT SELECT ON rls_ids TO qingyu_app;
SELECT id::text AS rls_user_a
FROM app.user_accounts
WHERE appwrite_user_id='rls-test-a'
\gset

SET LOCAL ROLE qingyu_app;
SELECT set_config('app.user_id', :'rls_user_a', true);

DO $$
DECLARE workspace_count integer; asset_count integer; target_b uuid; error_message text;
BEGIN
  -- 在异常捕获区外读取，读取失败不能被误判为 RLS 拒绝写入。
  SELECT workspace_b INTO STRICT target_b FROM rls_ids;
  SELECT count(*) INTO workspace_count FROM app.workspaces;
  SELECT count(*) INTO asset_count FROM app.assets;
  IF workspace_count <> 1 OR asset_count <> 1 THEN
    RAISE EXCEPTION 'RLS 查询隔离失败：workspace=% asset=%', workspace_count, asset_count;
  END IF;
  INSERT INTO app.assets(workspace_id, asset_type, title)
  SELECT id, 'image', '自己的合法写入' FROM app.workspaces;
  BEGIN
    INSERT INTO app.assets(workspace_id, asset_type, title)
    VALUES (target_b, 'image', '越权写入');
    RAISE EXCEPTION 'RLS 未拒绝越权写入';
  EXCEPTION WHEN insufficient_privilege THEN
    GET STACKED DIAGNOSTICS error_message = MESSAGE_TEXT;
    IF error_message NOT LIKE '%row-level security%assets%' THEN
      RAISE EXCEPTION '不是预期的 assets 行级安全错误：%', error_message;
    END IF;
    RAISE NOTICE 'PASS: RLS 只能读取自己的空间，并拒绝写入 B 空间';
  END;
END $$;

SELECT set_config('app.user_id', '', true);
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM app.assets) OR EXISTS (SELECT 1 FROM app.workspaces) THEN
    RAISE EXCEPTION '没有用户身份时仍可读取空间数据';
  END IF;
  RAISE NOTICE 'PASS: 空身份默认拒绝读取';
END $$;

ROLLBACK;
