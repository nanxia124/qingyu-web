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

SET LOCAL ROLE qingyu_app;
SELECT set_config('app.user_id', (SELECT id::text FROM app.user_accounts WHERE appwrite_user_id='rls-test-a'), true);

DO $$
DECLARE workspace_count integer; asset_count integer;
BEGIN
  SELECT count(*) INTO workspace_count FROM app.workspaces;
  SELECT count(*) INTO asset_count FROM app.assets;
  IF workspace_count <> 1 OR asset_count <> 1 THEN
    RAISE EXCEPTION 'RLS 查询隔离失败：workspace=% asset=%', workspace_count, asset_count;
  END IF;
  BEGIN
    INSERT INTO app.assets(workspace_id, asset_type, title)
    SELECT workspace_b, 'image', '越权写入' FROM rls_ids;
    RAISE EXCEPTION 'RLS 未拒绝越权写入';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS: RLS 只能读取自己的空间，并拒绝写入 B 空间';
  END;
END $$;

ROLLBACK;
