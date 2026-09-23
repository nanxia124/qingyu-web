-- 所有测试数据在结束时回滚，不留下假用户或假资产。
\set ON_ERROR_STOP on
BEGIN;
DO $$
DECLARE
 u uuid; wa uuid; wb uuid; aa uuid; ab uuid; av uuid; fa uuid; fb uuid; ca uuid;
BEGIN
 INSERT INTO app.user_accounts(appwrite_user_id) VALUES ('test-' || gen_random_uuid()) RETURNING id INTO u;
 INSERT INTO app.workspaces(type,owner_user_id,name) VALUES ('personal',u,'隔离测试 A') RETURNING id INTO wa;
 -- 第二个个人空间归属于不同用户。
 INSERT INTO app.user_accounts(appwrite_user_id) VALUES ('test-' || gen_random_uuid()) RETURNING id INTO u;
 INSERT INTO app.workspaces(type,owner_user_id,name) VALUES ('personal',u,'隔离测试 B') RETURNING id INTO wb;
 INSERT INTO app.assets(workspace_id,asset_type,title) VALUES (wa,'image','A') RETURNING id INTO aa;
 INSERT INTO app.assets(workspace_id,asset_type,title) VALUES (wb,'image','B') RETURNING id INTO ab;
 INSERT INTO app.asset_versions(asset_id,workspace_id,version_no) VALUES (aa,wa,1) RETURNING id INTO av;
 INSERT INTO app.file_objects(workspace_id,storage_provider,bucket,object_key)
 VALUES (wa,'test','test',gen_random_uuid()::text) RETURNING id INTO fa;
 INSERT INTO app.file_objects(workspace_id,storage_provider,bucket,object_key)
 VALUES (wb,'test','test',gen_random_uuid()::text) RETURNING id INTO fb;
 INSERT INTO app.asset_files(asset_version_id,file_id,workspace_id,role) VALUES (av,fa,wa,'source');
 BEGIN
   INSERT INTO app.asset_files(asset_version_id,file_id,workspace_id,role) VALUES (av,fb,wa,'source');
   RAISE EXCEPTION '未拒绝跨空间文件';
 EXCEPTION WHEN foreign_key_violation THEN NULL; END;
 INSERT INTO app.asset_comments(asset_id,content) VALUES (aa,'父评论') RETURNING id INTO ca;
 INSERT INTO app.asset_comments(asset_id,parent_id,content) VALUES (aa,ca,'合法回复');
 BEGIN
   INSERT INTO app.asset_comments(asset_id,parent_id,content) VALUES (ab,ca,'非法回复');
   RAISE EXCEPTION '未拒绝跨资产回复';
 EXCEPTION WHEN foreign_key_violation THEN NULL; END;
 BEGIN
   INSERT INTO app.file_objects(workspace_id,storage_provider,bucket,object_key)
   SELECT workspace_id,storage_provider,bucket,object_key FROM app.file_objects WHERE id=fa;
   RAISE EXCEPTION '未拒绝空版本重复文件';
 EXCEPTION WHEN unique_violation THEN NULL; END;
 RAISE NOTICE 'PASS: 同空间文件、跨空间拒绝、同资产回复、跨资产拒绝、空版本去重';
END $$;
ROLLBACK;
