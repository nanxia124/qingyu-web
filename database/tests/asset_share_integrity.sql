-- 验证资产分享目标的类型、编号和实际对象一致。
\set ON_ERROR_STOP on
BEGIN;
DO $$
DECLARE u uuid; w uuid; a uuid;
BEGIN
  INSERT INTO app.user_accounts(appwrite_user_id) VALUES ('share-test-' || gen_random_uuid()) RETURNING id INTO u;
  INSERT INTO app.workspaces(type,owner_user_id,name) VALUES ('personal',u,'分享目标测试') RETURNING id INTO w;
  INSERT INTO app.assets(workspace_id,asset_type,title) VALUES (w,'image','分享测试') RETURNING id INTO a;
  INSERT INTO app.asset_shares(asset_id,workspace_id,target_type,permission) VALUES (a,w,'public_link','view');
  BEGIN
    INSERT INTO app.asset_shares(asset_id,workspace_id,target_type,target_id,permission)
    VALUES (a,w,'user',gen_random_uuid(),'view');
    RAISE EXCEPTION '未拒绝不存在的用户分享目标';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%分享目标用户不存在%' THEN RAISE; END IF;
  END;
  BEGIN
    INSERT INTO app.asset_shares(asset_id,workspace_id,target_type,target_id,permission)
    VALUES (a,w,'public_link',gen_random_uuid(),'view');
    RAISE EXCEPTION '未拒绝公开链接目标编号';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%公开链接分享不能填写%' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'PASS: 分享目标类型和对象存在性被校验';
END $$;
ROLLBACK;
