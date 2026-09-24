-- 事件归属测试只在事务中运行，结束后全部回滚。
BEGIN;
DO $$
DECLARE u1 uuid; u2 uuid; w1 uuid; w2 uuid; team1 uuid; asset1 uuid; rejected text;
BEGIN
  INSERT INTO app.user_accounts(appwrite_user_id) VALUES ('verify-outbox-'||gen_random_uuid()) RETURNING id INTO u1;
  INSERT INTO app.user_accounts(appwrite_user_id) VALUES ('verify-outbox-'||gen_random_uuid()) RETURNING id INTO u2;
  INSERT INTO app.workspaces(type,owner_user_id,name) VALUES ('personal',u1,'事件测试甲') RETURNING id INTO w1;
  INSERT INTO app.workspaces(type,owner_user_id,name) VALUES ('personal',u2,'事件测试乙') RETURNING id INTO w2;
  INSERT INTO app.assets(workspace_id,created_by,asset_type,title) VALUES(w1,u1,'image','事件资产') RETURNING id INTO asset1;
  INSERT INTO app.outbox_events(event_type,aggregate_type,aggregate_id,workspace_id,payload) VALUES('asset.created','asset',asset1,w1,'{}');
  BEGIN
    INSERT INTO app.outbox_events(event_type,aggregate_type,aggregate_id,workspace_id,payload) VALUES('asset.created','asset',asset1,w2,'{}');
    RAISE EXCEPTION '跨空间资产事件未被拒绝';
  EXCEPTION WHEN others THEN
    IF SQLERRM NOT LIKE '%资产事件和工作空间不一致%' THEN RAISE; END IF;
  END;
  INSERT INTO app.teams(name,slug,owner_user_id) VALUES('事件团队','outbox-'||replace(gen_random_uuid()::text,'-',''),u1) RETURNING id INTO team1;
  INSERT INTO app.workspaces(type,team_id,name) VALUES('team',team1,'事件团队空间') RETURNING id INTO w1;
  INSERT INTO app.outbox_events(event_type,aggregate_type,aggregate_id,workspace_id,payload) VALUES('team.created','team',team1,w1,'{}');
  BEGIN
    INSERT INTO app.outbox_events(event_type,aggregate_type,aggregate_id,workspace_id,payload) VALUES('team.created','team',team1,w2,'{}');
    RAISE EXCEPTION '跨空间团队事件未被拒绝';
  EXCEPTION WHEN others THEN
    IF SQLERRM NOT LIKE '%团队事件和工作空间不一致%' THEN RAISE; END IF;
  END;
END $$;
ROLLBACK;
